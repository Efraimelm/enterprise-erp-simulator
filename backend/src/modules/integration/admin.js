// Administração da integração: clientes (usuários técnicos) e chaves de API, webhooks, eventos e logs.
//
//   GET  /api/integration/clients                       ADMIN.INTEGRATION.READ
//   POST /api/integration/clients                       ADMIN.INTEGRATION.MAINTAIN  { name, roles[], scopes[], key_name?, expires_at? } → chave (1 vez)
//   POST /api/integration/clients/:userId/keys          ADMIN.INTEGRATION.MAINTAIN  { name, expires_at? } → nova chave (1 vez)
//   POST /api/integration/keys/:id/revoke               ADMIN.INTEGRATION.MAINTAIN
//   GET  /api/integration/event-types                   ADMIN.INTEGRATION.READ
//   GET  /api/integration/webhooks                      ADMIN.INTEGRATION.READ
//   POST /api/integration/webhooks                      ADMIN.INTEGRATION.MAINTAIN  { name, url, events[] } → segredo (1 vez)
//   PUT  /api/integration/webhooks/:id                  ADMIN.INTEGRATION.MAINTAIN  { name, url, events[], is_active }
//   POST /api/integration/webhooks/:id/rotate-secret    ADMIN.INTEGRATION.MAINTAIN  → novo segredo (1 vez)
//   POST /api/integration/webhooks/:id/test             ADMIN.INTEGRATION.MAINTAIN  envia integration.ping agora
//   GET  /api/integration/events                        ADMIN.INTEGRATION.READ      eventos com o status das entregas
//   POST /api/integration/deliveries/:id/retry          ADMIN.INTEGRATION.MAINTAIN  reenvia (FAILED/DEAD → PENDING)
//   GET  /api/integration/logs                          ADMIN.INTEGRATION.READ      (direction, errors)
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { encrypt, randomSecret, sha256 } from '../../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { EVENT_TYPES, emitEvent } from '../../lib/events.js';
import { hashPassword } from '../../lib/password.js';
import { dispatchPending } from '../../lib/webhooks.js';
import { requirePermission } from '../../middleware/auth.js';
import { setRoles, setScopes } from '../admin/users.js';
import { pageSchema, parseId } from '../mm/common.js';

const zUrl = z.string().trim().url('URL inválida.').max(500).refine((u) => /^https?:\/\//i.test(u), 'Use http:// ou https://.');
const zEvents = z.array(z.string()).min(1, 'Escolha pelo menos um evento.').refine((l) => l.every((e) => e === '*' || EVENT_TYPES[e]), 'Evento desconhecido.');
const zExpires = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable().optional()).refine((d) => !d || d > new Date(), 'A validade precisa ser futura.');

/** Gera uma chave nova: só o hash vai para o banco; o texto volta uma única vez para quem criou. */
async function createKey(trx, userId, name, expiresAt, createdBy) {
  const prefix = crypto.randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8).padEnd(8, 'x');
  const full = `erp_${prefix}_${randomSecret(30)}`;
  const [id] = await trx('api_keys').insert({ user_id: userId, name, prefix, key_hash: sha256(full), expires_at: expiresAt ?? null, created_by: createdBy });
  return { id, prefix, key: full };
}

export const integrationRouter = Router();

integrationRouter.get('/clients', requirePermission('ADMIN.INTEGRATION.READ'), async (req, res) => {
  const users = await db('users').where({ is_technical: true }).select('id', 'username', 'full_name', 'status', 'created_at').orderBy('username');
  const ids = users.map((u) => u.id);
  const keys = ids.length ? await db('api_keys').whereIn('user_id', ids).select('id', 'user_id', 'name', 'prefix', 'expires_at', 'revoked_at', 'last_used_at', 'created_at').orderBy('id', 'desc') : [];
  const roles = ids.length ? await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').whereIn('ur.user_id', ids).select('ur.user_id', 'r.code') : [];
  const scopes = ids.length ? await db('user_org_scopes as s').leftJoin('plants as p', 'p.id', 's.plant_id').leftJoin('companies as c', 'c.id', 's.company_id')
    .whereIn('s.user_id', ids).select('s.user_id', 's.scope_type', 'p.code as plant_code', 'c.code as company_code') : [];
  res.json({
    data: users.map((u) => ({
      ...u,
      roles: roles.filter((r) => r.user_id === u.id).map((r) => r.code),
      scopes: scopes.filter((s) => s.user_id === u.id).map((s) => (s.scope_type === 'ALL' ? 'Todos' : s.scope_type === 'COMPANY' ? `Empresa ${s.company_code}` : `Centro ${s.plant_code}`)),
      keys: keys.filter((k) => k.user_id === u.id).map((k) => ({ ...k, status: k.revoked_at ? 'REVOKED' : k.expires_at && new Date(k.expires_at) < new Date() ? 'EXPIRED' : 'ACTIVE' })),
    })),
  });
});

integrationRouter.post('/clients', requirePermission('ADMIN.INTEGRATION.MAINTAIN'), async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(3, 'Informe o nome.').max(80),
    roles: z.array(z.string().trim().toUpperCase()).min(1, 'Escolha pelo menos uma role.').max(10),
    scopes: z.array(z.object({ type: z.enum(['ALL', 'COMPANY', 'PLANT']), company_id: z.number().int().positive().optional(), plant_id: z.number().int().positive().optional() }).strict()).min(1, 'Defina o escopo.'),
    key_name: z.string().trim().max(80).optional(),
    expires_at: zExpires,
  }).strict().parse(req.body);
  if (!req.user.permissions.has('ADMIN.ROLE.ASSIGN')) throw forbidden('Criar cliente de integração exige também ADMIN.ROLE.ASSIGN (define roles e escopo).');
  const result = await db.transaction(async (trx) => {
    const username = `int.${body.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)}.${crypto.randomBytes(2).toString('hex')}`;
    const [userId] = await trx('users').insert({
      username, full_name: `Integração: ${body.name}`, password_hash: await hashPassword(randomSecret(32)),
      must_change_password: false, is_technical: true,
    });
    const roles = await setRoles(req, userId, body.roles, trx);
    const scopes = await setScopes(req, userId, body.scopes, trx);
    const key = await createKey(trx, userId, body.key_name || 'Chave principal', body.expires_at, req.user.id);
    await audit(req, { action: 'CREATE', entity: 'integration_clients', entityId: userId, result: 'SUCCESS', details: { username, roles, scopes, chave: key.prefix } }, trx);
    return { user_id: userId, username, key_id: key.id, prefix: key.prefix, apiKey: key.key };
  });
  res.status(201).json({ data: result, warning: 'Copie a chave agora: ela não será mostrada de novo.' });
});

integrationRouter.post('/clients/:userId/keys', requirePermission('ADMIN.INTEGRATION.MAINTAIN'), async (req, res) => {
  const userId = parseId(req.params.userId, 'Cliente');
  const body = z.object({ name: z.string().trim().min(3).max(80), expires_at: zExpires }).strict().parse(req.body);
  const result = await db.transaction(async (trx) => {
    const user = await trx('users').where({ id: userId, is_technical: true }).first('id');
    if (!user) throw notFound('Cliente de integração não encontrado.');
    const key = await createKey(trx, userId, body.name, body.expires_at, req.user.id);
    await audit(req, { action: 'CREATE_KEY', entity: 'integration_clients', entityId: userId, result: 'SUCCESS', details: { chave: key.prefix, nome: body.name } }, trx);
    return { key_id: key.id, prefix: key.prefix, apiKey: key.key };
  });
  res.status(201).json({ data: result, warning: 'Copie a chave agora: ela não será mostrada de novo.' });
});

integrationRouter.post('/keys/:id/revoke', requirePermission('ADMIN.INTEGRATION.MAINTAIN'), async (req, res) => {
  const id = parseId(req.params.id, 'Chave');
  await db.transaction(async (trx) => {
    const key = await trx('api_keys').where({ id }).forUpdate().first();
    if (!key) throw notFound('Chave não encontrada.');
    if (!key.revoked_at) await trx('api_keys').where({ id }).update({ revoked_at: new Date() });
    await audit(req, { action: 'REVOKE_KEY', entity: 'integration_clients', entityId: key.user_id, result: 'SUCCESS', details: { chave: key.prefix } }, trx);
  });
  res.status(204).end();
});

integrationRouter.get('/event-types', requirePermission('ADMIN.INTEGRATION.READ'), (req, res) => {
  res.json({ data: Object.entries(EVENT_TYPES).filter(([k]) => k !== 'integration.ping').map(([type, description]) => ({ type, description })) });
});

const publicSub = (s) => ({ ...s, secret_encrypted: undefined, events: typeof s.events === 'string' ? JSON.parse(s.events) : s.events, is_active: !!s.is_active });

integrationRouter.get('/webhooks', requirePermission('ADMIN.INTEGRATION.READ'), async (req, res) => {
  const subs = await db('webhook_subscriptions').orderBy('id');
  const stats = await db('webhook_deliveries').groupBy('subscription_id', 'status').select('subscription_id', 'status').count({ n: '*' });
  res.json({
    data: subs.map((s) => ({
      ...publicSub(s),
      deliveries: Object.fromEntries(stats.filter((x) => x.subscription_id === s.id).map((x) => [x.status, Number(x.n)])),
    })),
  });
});

integrationRouter.post('/webhooks', requirePermission('ADMIN.INTEGRATION.MAINTAIN'), async (req, res) => {
  const body = z.object({ name: z.string().trim().min(3).max(80), url: zUrl, events: zEvents }).strict().parse(req.body);
  const secret = randomSecret(32);
  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('webhook_subscriptions').insert({ ...body, events: JSON.stringify(body.events), secret_encrypted: encrypt(secret), created_by: req.user.id });
    await audit(req, { action: 'CREATE', entity: 'webhook_subscriptions', entityId: newId, result: 'SUCCESS', details: { nome: body.name, url: body.url, eventos: body.events } }, trx);
    return newId;
  });
  res.status(201).json({ data: { ...publicSub(await db('webhook_subscriptions').where({ id }).first()), secret }, warning: 'Copie o segredo agora: ele não será mostrado de novo.' });
});

integrationRouter.put('/webhooks/:id', requirePermission('ADMIN.INTEGRATION.MAINTAIN'), async (req, res) => {
  const id = parseId(req.params.id, 'Webhook');
  const body = z.object({ name: z.string().trim().min(3).max(80), url: zUrl, events: zEvents, is_active: z.boolean() }).strict().parse(req.body);
  await db.transaction(async (trx) => {
    const before = await trx('webhook_subscriptions').where({ id }).forUpdate().first();
    if (!before) throw notFound('Webhook não encontrado.');
    await trx('webhook_subscriptions').where({ id }).update({ ...body, events: JSON.stringify(body.events) });
    await audit(req, { action: 'UPDATE', entity: 'webhook_subscriptions', entityId: id, result: 'SUCCESS', details: { para: body } }, trx);
  });
  res.json({ data: publicSub(await db('webhook_subscriptions').where({ id }).first()) });
});

integrationRouter.post('/webhooks/:id/rotate-secret', requirePermission('ADMIN.INTEGRATION.MAINTAIN'), async (req, res) => {
  const id = parseId(req.params.id, 'Webhook');
  const secret = randomSecret(32);
  const n = await db('webhook_subscriptions').where({ id }).update({ secret_encrypted: encrypt(secret) });
  if (!n) throw notFound('Webhook não encontrado.');
  await audit(req, { action: 'ROTATE_SECRET', entity: 'webhook_subscriptions', entityId: id, result: 'SUCCESS' });
  res.json({ data: { id, secret }, warning: 'Atualize o segredo no receptor (n8n). O anterior deixou de valer.' });
});

integrationRouter.post('/webhooks/:id/test', requirePermission('ADMIN.INTEGRATION.MAINTAIN'), async (req, res) => {
  const id = parseId(req.params.id, 'Webhook');
  const sub = await db('webhook_subscriptions').where({ id }).first('id', 'is_active');
  if (!sub) throw notFound('Webhook não encontrado.');
  if (!sub.is_active) throw badRequest('Ative o webhook antes de testar.');
  await db.transaction((trx) => emitEvent(trx, 'integration.ping', { subscription_id: id, message: 'Teste de conexão do Enterprise ERP Simulator', requested_by: req.user.username }));
  await dispatchPending();
  const last = await db('webhook_deliveries as d').join('integration_events as e', 'e.id', 'd.event_id')
    .where({ 'd.subscription_id': id, 'e.event_type': 'integration.ping' }).orderBy('d.id', 'desc')
    .first('d.id', 'd.status', 'd.last_status_code', 'd.last_error', 'd.attempts');
  res.json({ data: last });
});

integrationRouter.get('/events', requirePermission('ADMIN.INTEGRATION.READ'), async (req, res) => {
  const f = z.object({ ...pageSchema, type: z.string().max(60).optional(), status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'DEAD']).optional() }).parse(req.query);
  const base = db('integration_events as e').where((q) => {
    if (f.type) q.where('e.event_type', f.type);
    if (f.status) q.whereIn('e.id', db('webhook_deliveries').where('status', f.status).select('event_id'));
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const events = await base.clone().orderBy('e.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize)
    .select('e.id', 'e.event_id', 'e.event_type', 'e.occurred_at', 'e.dispatched_at', 'e.payload');
  const deliveries = events.length
    ? await db('webhook_deliveries as d').join('webhook_subscriptions as s', 's.id', 'd.subscription_id').whereIn('d.event_id', events.map((e) => e.id))
      .select('d.id', 'd.event_id', 'd.status', 'd.attempts', 'd.last_status_code', 'd.last_error', 'd.next_attempt_at', 'd.delivered_at', 's.name as subscription')
    : [];
  res.json({
    data: events.map((e) => ({ ...e, payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload, deliveries: deliveries.filter((d) => d.event_id === e.id) })),
    page: f.page, pageSize: f.pageSize, total: Number(total),
  });
});

integrationRouter.post('/deliveries/:id/retry', requirePermission('ADMIN.INTEGRATION.MAINTAIN'), async (req, res) => {
  const id = parseId(req.params.id, 'Entrega');
  const n = await db('webhook_deliveries').where({ id }).whereIn('status', ['FAILED', 'DEAD']).update({ status: 'PENDING', next_attempt_at: new Date(), attempts: 0 });
  if (!n) throw notFound('Entrega não encontrada ou já concluída.');
  await audit(req, { action: 'RETRY', entity: 'webhook_deliveries', entityId: id, result: 'SUCCESS' });
  await dispatchPending();
  res.json({ data: await db('webhook_deliveries').where({ id }).first('id', 'status', 'attempts', 'last_status_code', 'last_error') });
});

integrationRouter.get('/logs', requirePermission('ADMIN.INTEGRATION.READ'), async (req, res) => {
  const f = z.object({ ...pageSchema, direction: z.enum(['IN', 'OUT']).optional(), errors: z.enum(['true', 'false']).optional() }).parse(req.query);
  const base = db('integration_logs as l').where((q) => {
    if (f.direction) q.where('l.direction', f.direction);
    if (f.errors === 'true') q.where((w) => w.where('l.status_code', '>=', 400).orWhereNotNull('l.error'));
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone().leftJoin('api_keys as k', 'k.id', 'l.api_key_id').leftJoin('webhook_subscriptions as s', 's.id', 'l.subscription_id')
    .select('l.*', 'k.name as key_name', 'k.prefix as key_prefix', 's.name as subscription_name').orderBy('l.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});
