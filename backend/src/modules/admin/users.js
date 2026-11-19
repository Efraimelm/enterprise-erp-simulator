// Administração de usuários.
//
//   GET  /api/admin/users                  lista (q, status, role, page, pageSize)        ADMIN.USER.READ
//   GET  /api/admin/users/:id              detalhe com roles e escopo                    ADMIN.USER.READ
//   POST /api/admin/users                  cria com senha provisória (mostrada 1 vez)    ADMIN.USER.CREATE (+ ADMIN.ROLE.ASSIGN se enviar roles/escopo)
//   PUT  /api/admin/users/:id              altera nome e e-mail                          ADMIN.USER.UPDATE
//   POST /api/admin/users/:id/status       ativa, bloqueia ou inativa                    ADMIN.USER.UPDATE
//   POST /api/admin/users/:id/reset-password  nova senha provisória                      ADMIN.USER.UPDATE
//   PUT  /api/admin/users/:id/roles        define as roles                               ADMIN.ROLE.ASSIGN
//   PUT  /api/admin/users/:id/scopes       define o escopo organizacional                ADMIN.ROLE.ASSIGN
//
// Regras de proteção:
//   - ninguém altera o próprio status, roles ou escopo (peça a outro administrador)
//   - ninguém concede permissões ou escopo que não tem (sem escalada de privilégio)
//   - o sistema nunca fica sem um SAP_ADMIN ativo
//   - bloquear, inativar ou redefinir a senha encerra as sessões abertas do usuário
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { scopeWithin } from '../../lib/scope.js';
import { requirePermission } from '../../middleware/auth.js';

const STATUSES = ['ACTIVE', 'BLOCKED', 'INACTIVE'];

const roleCodes = z.array(z.string().trim().toUpperCase().max(40)).max(20);
const scopeItem = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ALL') }),
  z.object({ type: z.literal('COMPANY'), company_id: z.coerce.number().int().positive() }),
  z.object({ type: z.literal('PLANT'), plant_id: z.coerce.number().int().positive() }),
]);
const scopeList = z.array(scopeItem).max(50);

const profile = {
  full_name: z.string().trim().min(3, 'Informe o nome completo.').max(120),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().email('E-mail inválido.').max(160).nullable().optional()),
};
const createSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9._-]{2,39}$/, 'Use de 3 a 40 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado, começando por letra.'),
  ...profile,
  roles: roleCodes.default([]),
  scopes: scopeList.default([]),
}).strict();
const updateSchema = z.object(profile).strict();
const statusSchema = z.object({ status: z.enum(STATUSES), reason: z.string().trim().min(3, 'Informe o motivo.').max(255) }).strict();
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(80).optional(),
  status: z.enum(STATUSES).optional(),
  role: z.string().trim().toUpperCase().max(40).optional(),
});

/** Senha provisória forte, que já atende à política (12+ caracteres, 4 tipos). */
const temporaryPassword = () => `Tmp-${crypto.randomBytes(9).toString('base64url')}7a`;

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw notFound('Usuário não encontrado.');
  return id;
};

async function loadUsers(ids, trx = db) {
  if (!ids.length) return [];
  const users = await trx('users')
    .whereIn('id', ids)
    .select('id', 'username', 'full_name', 'email', 'status', 'must_change_password', 'locked_until', 'last_login_at', 'created_at', 'updated_at');
  const roles = await trx('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').whereIn('ur.user_id', ids).select('ur.user_id', 'r.code', 'r.name');
  const scopes = await trx('user_org_scopes as s')
    .leftJoin('companies as c', 'c.id', 's.company_id')
    .leftJoin('plants as p', 'p.id', 's.plant_id')
    .whereIn('s.user_id', ids)
    .select('s.user_id', 's.scope_type as type', 's.company_id', 's.plant_id', 'c.code as company_code', 'p.code as plant_code');
  const byId = new Map(ids.map((id, i) => [id, i]));
  return users
    .map((u) => ({
      ...u,
      must_change_password: !!u.must_change_password,
      locked: !!(u.locked_until && new Date(u.locked_until) > new Date()),
      roles: roles.filter((r) => r.user_id === u.id).map(({ code, name }) => ({ code, name })),
      scopes: scopes.filter((s) => s.user_id === u.id).map(({ type, company_id, plant_id, company_code, plant_code }) => ({
        type, company_id, plant_id, label: type === 'ALL' ? 'Todos' : type === 'COMPANY' ? `Empresa ${company_code}` : `Centro ${plant_code}`,
      })),
    }))
    .sort((a, b) => byId.get(a.id) - byId.get(b.id));
}

async function getUser(id, trx = db) {
  const [user] = await loadUsers([id], trx);
  if (!user) throw notFound('Usuário não encontrado.');
  return user;
}

function notSelf(req, id, what) {
  if (req.user.id === id) throw forbidden(`Você não pode alterar ${what} do seu próprio usuário. Peça a outro administrador.`, 'SELF_CHANGE');
}

async function assertNotLastAdmin(trx) {
  const [{ n }] = await trx('users as u')
    .join('user_roles as ur', 'ur.user_id', 'u.id')
    .join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'r.code': 'SAP_ADMIN', 'u.status': 'ACTIVE' })
    .countDistinct({ n: 'u.id' });
  if (Number(n) === 0) throw conflict('Operação recusada: o sistema ficaria sem nenhum administrador (SAP_ADMIN) ativo.');
}

async function revokeSessions(userId, trx) {
  await trx('sessions').where({ user_id: userId }).del();
}

/** Valida e grava as roles. Recusa role inexistente e role com permissão que quem atribui não tem. */
async function setRoles(req, userId, codes, trx) {
  const unique = [...new Set(codes)];
  const roles = unique.length ? await trx('roles').whereIn('code', unique).select('id', 'code') : [];
  const missing = unique.filter((c) => !roles.some((r) => r.code === c));
  if (missing.length) throw badRequest('Role inexistente.', missing.map((c) => ({ field: 'roles', message: `Role ${c} não existe.` })));

  if (roles.length) {
    const perms = await trx('role_permissions as rp').join('permissions as p', 'p.id', 'rp.permission_id').whereIn('rp.role_id', roles.map((r) => r.id)).distinct().pluck('p.code');
    const excess = perms.filter((p) => !req.user.permissions.has(p));
    if (excess.length) {
      throw forbidden(`Você não pode conceder permissões que não possui: ${excess.slice(0, 5).join(', ')}${excess.length > 5 ? '…' : ''}.`, 'PRIVILEGE_ESCALATION');
    }
  }
  await trx('user_roles').where({ user_id: userId }).del();
  if (roles.length) await trx('user_roles').insert(roles.map((r) => ({ user_id: userId, role_id: r.id })));
  return unique;
}

/** Valida e grava o escopo. ALL substitui os demais. Ninguém concede escopo fora do próprio. */
async function setScopes(req, userId, scopes, trx) {
  const list = scopes.some((s) => s.type === 'ALL') ? [{ type: 'ALL' }] : scopes;
  const plantIds = list.filter((s) => s.type === 'PLANT').map((s) => s.plant_id);
  const companyIds = list.filter((s) => s.type === 'COMPANY').map((s) => s.company_id);
  const plants = plantIds.length ? await trx('plants').whereIn('id', plantIds).select('id', 'company_id') : [];
  const companies = companyIds.length ? await trx('companies').whereIn('id', companyIds).pluck('id') : [];
  if (plants.length !== new Set(plantIds).size || companies.length !== new Set(companyIds).size) {
    throw badRequest('Escopo inválido.', [{ field: 'scopes', message: 'Empresa ou centro inexistente.' }]);
  }
  const plantCompany = new Map(plants.map((p) => [p.id, p.company_id]));
  const outside = list.filter((s) => !scopeWithin(s, req.user.scope, plantCompany));
  if (outside.length) throw forbidden('Você não pode conceder escopo maior que o seu.', 'PRIVILEGE_ESCALATION');

  const seen = new Set();
  const rows = list
    .filter((s) => {
      const k = `${s.type}:${s.company_id ?? ''}:${s.plant_id ?? ''}`;
      return seen.has(k) ? false : seen.add(k);
    })
    .map((s) => ({ user_id: userId, scope_type: s.type, company_id: s.company_id ?? null, plant_id: s.plant_id ?? null, created_by: req.user.id }));
  await trx('user_org_scopes').where({ user_id: userId }).del();
  if (rows.length) await trx('user_org_scopes').insert(rows);
  return rows.map(({ scope_type, company_id, plant_id }) => ({ type: scope_type, company_id, plant_id }));
}

export const usersRouter = Router();

usersRouter.get('/', requirePermission('ADMIN.USER.READ'), async (req, res) => {
  const f = listSchema.parse(req.query);
  const base = db('users as u').where((qb) => {
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      qb.where((w) => w.where('u.username', 'like', like).orWhere('u.full_name', 'like', like).orWhere('u.email', 'like', like));
    }
    if (f.status) qb.where('u.status', f.status);
    if (f.role) qb.whereIn('u.id', db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('r.code', f.role).select('ur.user_id'));
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const ids = await base.clone().orderBy('u.username').limit(f.pageSize).offset((f.page - 1) * f.pageSize).pluck('u.id');
  res.json({ data: await loadUsers(ids), page: f.page, pageSize: f.pageSize, total: Number(total) });
});

usersRouter.get('/:id', requirePermission('ADMIN.USER.READ'), async (req, res) => {
  res.json({ data: await getUser(parseId(req.params.id)) });
});

usersRouter.post('/', requirePermission('ADMIN.USER.CREATE'), async (req, res) => {
  const body = createSchema.parse(req.body);
  if ((body.roles.length || body.scopes.length) && !req.user.permissions.has('ADMIN.ROLE.ASSIGN')) {
    throw forbidden('Para definir roles e escopo é preciso a permissão ADMIN.ROLE.ASSIGN.');
  }
  const password = temporaryPassword();
  const user = await db.transaction(async (trx) => {
    const [id] = await trx('users').insert({
      username: body.username,
      full_name: body.full_name,
      email: body.email ?? null,
      password_hash: await hashPassword(password),
      must_change_password: true,
    });
    const roles = await setRoles(req, id, body.roles, trx);
    const scopes = await setScopes(req, id, body.scopes, trx);
    await audit(req, { action: 'CREATE', entity: 'users', entityId: id, result: 'SUCCESS', details: { username: body.username, roles, scopes } }, trx);
    return getUser(id, trx);
  });
  // A senha provisória só aparece nesta resposta. Ela não é gravada em lugar nenhum além do hash.
  res.status(201).json({ data: user, temporaryPassword: password });
});

usersRouter.put('/:id', requirePermission('ADMIN.USER.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id);
  const body = updateSchema.parse(req.body);
  const user = await db.transaction(async (trx) => {
    const before = await trx('users').where({ id }).forUpdate().first('full_name', 'email');
    if (!before) throw notFound('Usuário não encontrado.');
    await trx('users').where({ id }).update({ full_name: body.full_name, email: body.email ?? null });
    await audit(req, { action: 'UPDATE', entity: 'users', entityId: id, result: 'SUCCESS', details: { de: before, para: body } }, trx);
    return getUser(id, trx);
  });
  res.json({ data: user });
});

usersRouter.post('/:id/status', requirePermission('ADMIN.USER.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id);
  notSelf(req, id, 'o status');
  const { status, reason } = statusSchema.parse(req.body);
  const user = await db.transaction(async (trx) => {
    const before = await trx('users').where({ id }).forUpdate().first('status');
    if (!before) throw notFound('Usuário não encontrado.');
    await trx('users').where({ id }).update({ status, ...(status === 'ACTIVE' ? { failed_attempts: 0, locked_until: null } : {}) });
    if (status !== 'ACTIVE') {
      await revokeSessions(id, trx);
      await assertNotLastAdmin(trx);
    }
    await audit(req, { action: 'STATUS', entity: 'users', entityId: id, result: 'SUCCESS', details: { de: before.status, para: status, motivo: reason } }, trx);
    return getUser(id, trx);
  });
  res.json({ data: user });
});

usersRouter.post('/:id/reset-password', requirePermission('ADMIN.USER.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id);
  notSelf(req, id, 'a senha (use "Trocar senha")');
  const password = temporaryPassword();
  const user = await db.transaction(async (trx) => {
    const exists = await trx('users').where({ id }).forUpdate().first('id');
    if (!exists) throw notFound('Usuário não encontrado.');
    await trx('users').where({ id }).update({
      password_hash: await hashPassword(password),
      must_change_password: true,
      failed_attempts: 0,
      locked_until: null,
    });
    await revokeSessions(id, trx);
    await audit(req, { action: 'RESET_PASSWORD', entity: 'users', entityId: id, result: 'SUCCESS' }, trx);
    return getUser(id, trx);
  });
  res.json({ data: user, temporaryPassword: password });
});

usersRouter.put('/:id/roles', requirePermission('ADMIN.ROLE.ASSIGN'), async (req, res) => {
  const id = parseId(req.params.id);
  notSelf(req, id, 'as roles');
  const { roles } = z.object({ roles: roleCodes }).strict().parse(req.body);
  const user = await db.transaction(async (trx) => {
    const before = await getUser(id, trx);
    const after = await setRoles(req, id, roles, trx);
    await assertNotLastAdmin(trx);
    await audit(req, { action: 'ASSIGN_ROLES', entity: 'users', entityId: id, result: 'SUCCESS', details: { de: before.roles.map((r) => r.code), para: after } }, trx);
    return getUser(id, trx);
  });
  res.json({ data: user });
});

usersRouter.put('/:id/scopes', requirePermission('ADMIN.ROLE.ASSIGN'), async (req, res) => {
  const id = parseId(req.params.id);
  notSelf(req, id, 'o escopo');
  const { scopes } = z.object({ scopes: scopeList }).strict().parse(req.body);
  const user = await db.transaction(async (trx) => {
    const before = await getUser(id, trx);
    const after = await setScopes(req, id, scopes, trx);
    await audit(req, { action: 'ASSIGN_SCOPES', entity: 'users', entityId: id, result: 'SUCCESS', details: { de: before.scopes.map((s) => s.label), para: after } }, trx);
    return getUser(id, trx);
  });
  res.json({ data: user });
});
