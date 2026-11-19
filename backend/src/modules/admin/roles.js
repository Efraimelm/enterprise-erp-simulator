// Roles e permissões.
//
//   GET    /api/admin/permissions        catálogo de permissões                 ADMIN.ROLE.READ
//   GET    /api/admin/roles              roles com permissões e nº de usuários   ADMIN.ROLE.READ
//   POST   /api/admin/roles              cria role personalizada (Z_…)           ADMIN.ROLE.MAINTAIN
//   PUT    /api/admin/roles/:id          altera role personalizada               ADMIN.ROLE.MAINTAIN
//   DELETE /api/admin/roles/:id          exclui role personalizada sem usuários  ADMIN.ROLE.MAINTAIN
//
// Roles de sistema (SAP_ADMIN, MM_MANAGER…) são definidas no seed e ficam somente leitura.
// Como no SAP, roles próprias começam com Z_ para não colidir com as de sistema.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../middleware/auth.js';

const roleBody = {
  name: z.string().trim().min(3, 'Informe o nome.').max(120),
  description: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(255).nullable().optional()),
  permissions: z.array(z.string().trim().toUpperCase().max(80)).max(200),
};
const createSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^Z_[A-Z0-9_]{2,38}$/, 'O código de roles personalizadas começa com Z_ (ex.: Z_COMPRAS_CF10).'),
  ...roleBody,
}).strict();
const updateSchema = z.object(roleBody).strict();

async function listRoles(trx = db, where = {}) {
  const roles = await trx('roles').where(where).select('id', 'code', 'name', 'description', 'is_system').orderBy([{ column: 'is_system', order: 'desc' }, 'code']);
  const perms = await trx('role_permissions as rp').join('permissions as p', 'p.id', 'rp.permission_id').select('rp.role_id', 'p.code');
  const users = await trx('user_roles').select('role_id').count({ n: '*' }).groupBy('role_id');
  return roles.map((r) => ({
    ...r,
    is_system: !!r.is_system,
    permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.code).sort(),
    user_count: Number(users.find((u) => u.role_id === r.id)?.n ?? 0),
  }));
}

async function resolvePermissions(req, codes, trx) {
  const unique = [...new Set(codes)];
  const found = unique.length ? await trx('permissions').whereIn('code', unique).select('id', 'code') : [];
  const missing = unique.filter((c) => !found.some((p) => p.code === c));
  if (missing.length) throw badRequest('Permissão inexistente.', missing.map((c) => ({ field: 'permissions', message: `${c} não existe.` })));
  const excess = unique.filter((c) => !req.user.permissions.has(c));
  if (excess.length) throw forbidden(`Você não pode incluir permissões que não possui: ${excess.slice(0, 5).join(', ')}.`, 'PRIVILEGE_ESCALATION');
  return found;
}

async function lockCustomRole(trx, id) {
  const role = await trx('roles').where({ id }).forUpdate().first();
  if (!role) throw notFound('Role não encontrada.');
  if (role.is_system) throw forbidden('Roles de sistema não podem ser alteradas. Crie uma role personalizada (Z_…).', 'SYSTEM_ROLE');
  return role;
}

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw notFound('Role não encontrada.');
  return id;
};

export const rolesRouter = Router();

rolesRouter.get('/permissions', requirePermission('ADMIN.ROLE.READ'), async (req, res) => {
  res.json({ data: await db('permissions').select('code', 'module', 'description').orderBy(['module', 'code']) });
});

rolesRouter.get('/roles', requirePermission('ADMIN.ROLE.READ'), async (req, res) => {
  res.json({ data: await listRoles() });
});

rolesRouter.post('/roles', requirePermission('ADMIN.ROLE.MAINTAIN'), async (req, res) => {
  const body = createSchema.parse(req.body);
  const role = await db.transaction(async (trx) => {
    const perms = await resolvePermissions(req, body.permissions, trx);
    const [id] = await trx('roles').insert({ code: body.code, name: body.name, description: body.description ?? null, is_system: false });
    if (perms.length) await trx('role_permissions').insert(perms.map((p) => ({ role_id: id, permission_id: p.id })));
    await audit(req, { action: 'CREATE', entity: 'roles', entityId: id, result: 'SUCCESS', details: { code: body.code, permissions: body.permissions } }, trx);
    return (await listRoles(trx, { id }))[0];
  });
  res.status(201).json({ data: role });
});

rolesRouter.put('/roles/:id', requirePermission('ADMIN.ROLE.MAINTAIN'), async (req, res) => {
  const id = parseId(req.params.id);
  const role = await db.transaction(async (trx) => {
    await lockCustomRole(trx, id); // role de sistema é recusada antes de validar o corpo
    const body = updateSchema.parse(req.body);
    const [before] = await listRoles(trx, { id });
    const perms = await resolvePermissions(req, body.permissions, trx);
    await trx('roles').where({ id }).update({ name: body.name, description: body.description ?? null });
    await trx('role_permissions').where({ role_id: id }).del();
    if (perms.length) await trx('role_permissions').insert(perms.map((p) => ({ role_id: id, permission_id: p.id })));
    const added = body.permissions.filter((p) => !before.permissions.includes(p));
    const removed = before.permissions.filter((p) => !body.permissions.includes(p));
    await audit(req, { action: 'UPDATE', entity: 'roles', entityId: id, result: 'SUCCESS', details: { incluidas: added, removidas: removed } }, trx);
    return (await listRoles(trx, { id }))[0];
  });
  res.json({ data: role });
});

rolesRouter.delete('/roles/:id', requirePermission('ADMIN.ROLE.MAINTAIN'), async (req, res) => {
  const id = parseId(req.params.id);
  await db.transaction(async (trx) => {
    const role = await lockCustomRole(trx, id);
    const inUse = await trx('user_roles').where({ role_id: id }).first('user_id');
    if (inUse) throw conflict('Há usuários com esta role. Retire a role deles antes de excluir.');
    await trx('roles').where({ id }).del();
    await audit(req, { action: 'DELETE', entity: 'roles', entityId: id, result: 'SUCCESS', details: { code: role.code } }, trx);
  });
  res.status(204).end();
});
