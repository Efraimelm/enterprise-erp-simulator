// API REST da estrutura organizacional, gerada a partir de entities.js.
//
//   GET    /api/org/meta                 definição das entidades e campos (para montar as telas)
//   GET    /api/org/:entity              lista com paginação, busca (q), filtros e ordenação
//   GET    /api/org/:entity/:id          um registro
//   POST   /api/org/:entity              cria
//   PUT    /api/org/:entity/:id          altera (envia o registro completo)
//   DELETE /api/org/:entity/:id          exclui (só se nada depender dele; senão, inativar)
//
// Segurança em duas camadas:
//   1) permissão (ADMIN.ORG.READ / CREATE / UPDATE / DELETE)
//   2) escopo organizacional (scope-rules.js): a lista só traz o que o usuário pode ver, e
//      acessar/alterar um registro de outro centro ou empresa responde 403 OUT_OF_SCOPE.
// Toda escrita gera auditoria na mesma transação da alteração.
import { Router } from 'express';
import { db } from '../../db.js';
import { audit, diff } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { buildEntitySchema, listQuerySchema } from '../../lib/validation.js';
import { denyOutOfScope, requirePermission } from '../../middleware/auth.js';
import { entities } from './entities.js';
import { applyReadScope, canWrite } from './scope-rules.js';

const SYSTEM_COLUMNS = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by'];

const prepared = Object.fromEntries(
  entities.map((e) => {
    const columns = e.fields.map((f) => f.name);
    return [
      e.key,
      {
        ...e,
        schema: buildEntitySchema(e.fields),
        columns: [...SYSTEM_COLUMNS, ...columns],
        searchable: e.fields.filter((f) => ['code', 'text', 'email'].includes(f.type)).map((f) => f.name),
        filterable: e.fields.filter((f) => ['ref', 'boolean'].includes(f.type)).map((f) => f.name),
        sortable: new Set(['id', 'created_at', 'updated_at', ...columns]),
        defaultSort: columns.includes('code') ? 'code' : 'id',
      },
    ];
  }),
);

function getEntity(req) {
  const e = prepared[req.params.entity];
  if (!e) throw notFound(`Entidade "${req.params.entity}" não existe.`);
  return e;
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}

/** Busca o registro respeitando o escopo: 404 se não existe, 403 se existe mas está fora do escopo. */
async function findInScope(req, e, id, trx = db, { lock = false } = {}) {
  let q = trx(e.table).where({ id });
  if (lock) q = q.forUpdate();
  const row = await q.first(e.columns);
  if (!row) throw notFound();
  const visible = await applyReadScope(trx(e.table).where({ id }), e.table, req.user.scope, trx).first('id');
  if (!visible) throw await denyOutOfScope(req, { entidade: e.table, id });
  return row;
}

async function assertCanWrite(req, e, row, trx) {
  if (!(await canWrite(e.table, row, req.user.scope, trx))) {
    throw await denyOutOfScope(req, { entidade: e.table, id: row.id ?? null, operacao: req.method });
  }
}

export const orgRouter = Router();

orgRouter.get('/meta', requirePermission('ADMIN.ORG.READ'), (req, res) => {
  res.json({
    data: entities.map(({ key, label, singular, sapConcept, fields }) => ({ key, label, singular, sapConcept, fields })),
  });
});

orgRouter.get('/:entity', requirePermission('ADMIN.ORG.READ'), async (req, res) => {
  const e = getEntity(req);
  const { page, pageSize, q, sort, order } = listQuerySchema.parse(req.query);

  const base = applyReadScope(db(e.table), e.table, req.user.scope, db).where((qb) => {
    if (q) qb.where((w) => e.searchable.forEach((col) => w.orWhere(col, 'like', `%${q.replace(/[%_\\]/g, '\\$&')}%`)));
    for (const col of e.filterable) {
      const v = req.query[col];
      if (v === undefined || v === '') continue;
      if (col === 'is_active') qb.where(col, v === 'true' || v === '1');
      else qb.where(col, Number(v) || 0);
    }
  });

  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base
    .clone()
    .select(e.columns)
    .orderBy(e.sortable.has(sort) ? sort : e.defaultSort, order)
    .orderBy('id', 'asc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({ data: data.map(normalize), page, pageSize, total: Number(total) });
});

orgRouter.get('/:entity/:id', requirePermission('ADMIN.ORG.READ'), async (req, res) => {
  const e = getEntity(req);
  res.json({ data: normalize(await findInScope(req, e, parseId(req.params.id))) });
});

orgRouter.post('/:entity', requirePermission('ADMIN.ORG.CREATE'), async (req, res) => {
  const e = getEntity(req);
  const values = e.schema.parse(req.body);
  const created = await db.transaction(async (trx) => {
    await assertCanWrite(req, e, values, trx);
    const [id] = await trx(e.table).insert({ ...values, created_by: req.user.id, updated_by: req.user.id });
    await audit(req, { action: 'CREATE', entity: e.table, entityId: id, result: 'SUCCESS', details: { novo: values } }, trx);
    return trx(e.table).where({ id }).first(e.columns);
  });
  res.status(201).json({ data: normalize(created) });
});

orgRouter.put('/:entity/:id', requirePermission('ADMIN.ORG.UPDATE'), async (req, res) => {
  const e = getEntity(req);
  const id = parseId(req.params.id);
  const values = e.schema.parse(req.body);
  const updated = await db.transaction(async (trx) => {
    const before = await findInScope(req, e, id, trx, { lock: true });
    await assertCanWrite(req, e, before, trx); // pode mexer no registro atual…
    await assertCanWrite(req, e, { ...values, id }, trx); // …e no resultado (ex.: mover depósito para outro centro)
    await trx(e.table).where({ id }).update({ ...values, updated_by: req.user.id });
    await audit(req, { action: 'UPDATE', entity: e.table, entityId: id, result: 'SUCCESS', details: { alteracoes: diff(normalize(before), values) } }, trx);
    return trx(e.table).where({ id }).first(e.columns);
  });
  res.json({ data: normalize(updated) });
});

orgRouter.delete('/:entity/:id', requirePermission('ADMIN.ORG.DELETE'), async (req, res) => {
  const e = getEntity(req);
  const id = parseId(req.params.id);
  await db.transaction(async (trx) => {
    const before = await findInScope(req, e, id, trx, { lock: true });
    await assertCanWrite(req, e, before, trx);
    await trx(e.table).where({ id }).del();
    await audit(req, { action: 'DELETE', entity: e.table, entityId: id, result: 'SUCCESS', details: { excluido: normalize(before) } }, trx);
  });
  res.status(204).end();
});

// MySQL devolve booleanos como 0/1; a API sempre responde true/false.
function normalize(row) {
  if (!row) return row;
  return { ...row, is_active: !!row.is_active };
}
