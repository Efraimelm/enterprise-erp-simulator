// Utilidades compartilhadas pelas rotas de MM: escopo por centro, paginação, validações e busca.
import { z } from 'zod';
import { db } from '../../db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { denyOutOfScope } from '../../middleware/auth.js';

export const pageSchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const zQty = z.coerce.number({ invalid_type_error: 'Informe a quantidade.' })
  .positive('A quantidade deve ser maior que zero.')
  .max(1e9, 'Quantidade muito grande.')
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Use no máximo 3 casas decimais.');
export const zMoney = z.coerce.number({ invalid_type_error: 'Informe o valor.' })
  .min(0, 'O valor não pode ser negativo.')
  .max(1e12, 'Valor muito grande.')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use no máximo 2 casas decimais.');
export const zId = z.coerce.number({ invalid_type_error: 'Selecione um registro.' }).int().positive('Selecione um registro.');
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Data inválida.');
export const zText = (max, msg = 'Campo obrigatório.') => z.string().trim().min(1, msg).max(max);
export const zOptText = (max) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const like = (q) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

export function parseId(raw, what = 'Registro') {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw notFound(`${what} não encontrado.`);
  return id;
}

/** O usuário tem o centro no escopo? Se não, registra e lança 403 OUT_OF_SCOPE. */
export async function assertPlant(req, plantId) {
  const s = req.user.scope;
  if (s.all || s.plantIds.has(Number(plantId))) return;
  throw await denyOutOfScope(req, { plant_id: plantId });
}

/** Restringe uma consulta aos centros do escopo do usuário. */
export function scopePlants(qb, req, column = 'plant_id') {
  const s = req.user.scope;
  if (!s.all) qb.whereIn(column, [...s.plantIds]);
  return qb;
}

/** Busca o registro e confere o escopo pelo centro (404 se não existe, 403 se fora do escopo). */
export async function findScoped(req, table, id, { trx = db, lock = false, what = 'Registro' } = {}) {
  let q = trx(table).where({ id });
  if (lock) q = q.forUpdate();
  const row = await q.first();
  if (!row) throw notFound(`${what} não encontrado.`);
  await assertPlant(req, row.plant_id);
  return row;
}

/** Depósito existe e pertence ao centro informado. */
export async function assertSlocInPlant(trx, slocId, plantId, field = 'storage_location_id') {
  const sloc = await trx('storage_locations').where({ id: slocId }).first('plant_id', 'is_active');
  if (!sloc || sloc.plant_id !== Number(plantId)) {
    throw badRequest('Depósito inválido.', [{ field, message: 'O depósito precisa ser do mesmo centro.' }]);
  }
  if (!sloc.is_active) throw badRequest('Depósito inativo.', [{ field, message: 'Depósito inativo.' }]);
}

/** Material ativo e estendido para o centro (tem dados de centro). */
export async function assertMaterialForPlant(trx, materialId, plantId, field = 'material_id') {
  const m = await trx('materials').where({ id: materialId }).first('id', 'code', 'status', 'reference_price', 'base_unit');
  if (!m) throw badRequest('Material inexistente.', [{ field, message: 'Material não encontrado.' }]);
  if (m.status !== 'ACTIVE') throw badRequest(`O material ${m.code} está ${m.status === 'BLOCKED' ? 'bloqueado' : 'inativo'}.`, [{ field, message: 'Material não está ativo.' }]);
  const plantData = await trx('material_plant_data').where({ material_id: materialId, plant_id: plantId }).first();
  if (!plantData) throw badRequest(`O material ${m.code} não está cadastrado para este centro.`, [{ field, message: 'Cadastre os dados do material para o centro.' }]);
  return { ...m, plantData };
}

/** Linha do tempo de um objeto a partir da auditoria (histórico de alterações). */
export async function history(entity, id) {
  const rows = await db('audit_logs')
    .where({ entity, entity_id: String(id) })
    .orderBy('id', 'desc')
    .limit(50)
    .select('occurred_at', 'username', 'action', 'result', 'details');
  return rows.map((r) => ({ ...r, details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details }));
}
