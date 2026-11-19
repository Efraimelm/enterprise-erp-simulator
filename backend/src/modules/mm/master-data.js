// Cadastros mestres de MM: materiais (com dados por centro) e fornecedores (com registros info).
//
// Materiais                                   permissão
//   GET    /api/mm/materials                    MM.MATERIAL.READ     (q, status, type, plant_id)
//   GET    /api/mm/materials/:id                MM.MATERIAL.READ     (dados por centro, estoque, histórico)
//   POST   /api/mm/materials                    MM.MATERIAL.CREATE
//   PUT    /api/mm/materials/:id                MM.MATERIAL.UPDATE
//   POST   /api/mm/materials/:id/status         MM.MATERIAL.UPDATE   { status, reason }
//   PUT    /api/mm/materials/:id/plants/:plant  MM.MATERIAL.UPDATE   dados do centro (escopo do centro)
// Fornecedores
//   GET    /api/mm/suppliers                    MM.SUPPLIER.READ
//   GET    /api/mm/suppliers/:id                MM.SUPPLIER.READ     (registros info, pedidos, histórico)
//   POST   /api/mm/suppliers                    MM.SUPPLIER.CREATE
//   PUT    /api/mm/suppliers/:id                MM.SUPPLIER.UPDATE
//   POST   /api/mm/suppliers/:id/status         MM.SUPPLIER.UPDATE
//   PUT    /api/mm/suppliers/:id/materials/:m   MM.SUPPLIER.UPDATE   registro info (preço, prazo)
//   DELETE /api/mm/suppliers/:id/materials/:m   MM.SUPPLIER.UPDATE
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit, diff } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../middleware/auth.js';
import { assertPlant, assertSlocInPlant, history, like, pageSchema, parseId, scopePlants, zId, zMoney, zOptText, zText } from './common.js';

export const MATERIAL_TYPES = { HAWA: 'Mercadoria para revenda', ROH: 'Matéria-prima', HIBE: 'Material de consumo' };
export const UNITS = ['UN', 'KG', 'G', 'L', 'ML', 'M', 'CX', 'PCT'];
const STATUSES = ['ACTIVE', 'BLOCKED', 'INACTIVE'];
const UF = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

const materialSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,18}$/, 'Use até 18 letras, números ou hífen.'),
  description: zText(120),
  material_type: z.enum(Object.keys(MATERIAL_TYPES), { message: 'Tipo inválido.' }),
  category: zOptText(60),
  base_unit: z.enum(UNITS, { message: `Unidade inválida. Use: ${UNITS.join(', ')}.` }),
  reference_price: zMoney,
}).strict();

const plantDataSchema = z.object({
  default_storage_location_id: z.preprocess((v) => (v === '' ? null : v), zId.nullable().optional()),
  purchasing_group_id: z.preprocess((v) => (v === '' ? null : v), zId.nullable().optional()),
  min_stock: z.coerce.number().min(0),
  reorder_point: z.coerce.number().min(0),
  max_stock: z.coerce.number().min(0),
}).strict().refine((d) => !d.max_stock || d.max_stock >= d.reorder_point, { message: 'O estoque máximo deve ser maior ou igual ao ponto de reposição.', path: ['max_stock'] });

const supplierSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,10}$/, 'Use até 10 letras ou números.'),
  name: zText(80),
  legal_name: zText(120),
  tax_id: zOptText(20),
  street: zOptText(120),
  city: zOptText(60),
  state: z.preprocess((v) => (v === '' ? null : typeof v === 'string' ? v.toUpperCase() : v), z.string().refine((s) => UF.has(s), 'UF inválida.').nullable().optional()),
  zip: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{5}-?\d{3}$/, 'CEP inválido.').nullable().optional()),
  contact_name: zOptText(80),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().email('E-mail inválido.').max(160).nullable().optional()),
  phone: zOptText(20),
  payment_term_id: z.preprocess((v) => (v === '' ? null : v), zId.nullable().optional()),
  overdelivery_tolerance_pct: z.coerce.number().min(0, 'Mínimo 0%.').max(50, 'Máximo 50%.'),
}).strict();

const statusSchema = z.object({ status: z.enum(STATUSES), reason: z.string().trim().min(3, 'Informe o motivo.').max(255) }).strict();
const infoRecordSchema = z.object({
  net_price: zMoney,
  lead_time_days: z.coerce.number().int().min(0).max(365),
  supplier_material_code: zOptText(30),
}).strict();

const nullify = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined ? null : v]));

export const masterDataRouter = Router();

/* ───────────── Materiais ───────────── */

masterDataRouter.get('/materials', requirePermission('MM.MATERIAL.READ'), async (req, res) => {
  const f = z.object({
    ...pageSchema,
    q: z.string().trim().max(80).optional(),
    status: z.enum(STATUSES).optional(),
    type: z.enum(Object.keys(MATERIAL_TYPES)).optional(),
    plant_id: zId.optional(),
  }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);

  const base = db('materials as m').where((qb) => {
    if (f.q) qb.where((w) => w.where('m.code', 'like', like(f.q)).orWhere('m.description', 'like', like(f.q)).orWhere('m.category', 'like', like(f.q)));
    if (f.status) qb.where('m.status', f.status);
    if (f.type) qb.where('m.material_type', f.type);
    if (f.plant_id) qb.whereIn('m.id', db('material_plant_data').where('plant_id', f.plant_id).select('material_id'));
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone().select('m.*').orderBy('m.code').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});

masterDataRouter.get('/materials/:id', requirePermission('MM.MATERIAL.READ'), async (req, res) => {
  const id = parseId(req.params.id, 'Material');
  const material = await db('materials').where({ id }).first();
  if (!material) throw notFound('Material não encontrado.');
  const plants = await scopePlants(db('material_plant_data as d'), req, 'd.plant_id')
    .join('plants as p', 'p.id', 'd.plant_id')
    .leftJoin('storage_locations as s', 's.id', 'd.default_storage_location_id')
    .leftJoin('purchasing_groups as g', 'g.id', 'd.purchasing_group_id')
    .where('d.material_id', id)
    .select('d.*', 'p.code as plant_code', 'p.name as plant_name', 's.code as sloc_code', 'g.code as purchasing_group_code')
    .orderBy('p.code');
  const stock = await scopePlants(db('stock_balances as b'), req, 'b.plant_id')
    .join('plants as p', 'p.id', 'b.plant_id')
    .join('storage_locations as s', 's.id', 'b.storage_location_id')
    .where('b.material_id', id)
    .select('b.plant_id', 'p.code as plant_code', 's.code as sloc_code', 's.name as sloc_name', 'b.storage_location_id', 'b.physical_qty', 'b.reserved_qty')
    .orderBy(['p.code', 's.code']);
  const suppliers = await db('supplier_materials as sm').join('suppliers as s', 's.id', 'sm.supplier_id')
    .where('sm.material_id', id).select('s.id', 's.code', 's.name', 's.status', 'sm.net_price', 'sm.lead_time_days').orderBy('sm.net_price');
  res.json({
    data: {
      ...material,
      plants,
      stock: stock.map((s) => ({ ...s, available_qty: +(s.physical_qty - s.reserved_qty).toFixed(3) })),
      suppliers,
      history: await history('materials', id),
    },
  });
});

masterDataRouter.post('/materials', requirePermission('MM.MATERIAL.CREATE'), async (req, res) => {
  const body = materialSchema.parse(req.body);
  const created = await db.transaction(async (trx) => {
    const [id] = await trx('materials').insert({ ...nullify(body), created_by: req.user.id, updated_by: req.user.id });
    await audit(req, { action: 'CREATE', entity: 'materials', entityId: id, result: 'SUCCESS', details: { novo: body } }, trx);
    return trx('materials').where({ id }).first();
  });
  res.status(201).json({ data: created });
});

masterDataRouter.put('/materials/:id', requirePermission('MM.MATERIAL.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Material');
  const body = materialSchema.parse(req.body);
  const updated = await db.transaction(async (trx) => {
    const before = await trx('materials').where({ id }).forUpdate().first();
    if (!before) throw notFound('Material não encontrado.');
    if (before.base_unit !== body.base_unit && (await trx('stock_movements').where({ material_id: id }).first('id'))) {
      throw badRequest('A unidade não pode mudar depois que o material teve movimentos de estoque.', [{ field: 'base_unit', message: 'Material já movimentado.' }]);
    }
    await trx('materials').where({ id }).update({ ...nullify(body), updated_by: req.user.id });
    await audit(req, { action: 'UPDATE', entity: 'materials', entityId: id, result: 'SUCCESS', details: { alteracoes: diff(before, body) } }, trx);
    return trx('materials').where({ id }).first();
  });
  res.json({ data: updated });
});

masterDataRouter.post('/materials/:id/status', requirePermission('MM.MATERIAL.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Material');
  const { status, reason } = statusSchema.parse(req.body);
  const updated = await db.transaction(async (trx) => {
    const before = await trx('materials').where({ id }).forUpdate().first('status');
    if (!before) throw notFound('Material não encontrado.');
    await trx('materials').where({ id }).update({ status, updated_by: req.user.id });
    await audit(req, { action: 'STATUS', entity: 'materials', entityId: id, result: 'SUCCESS', details: { de: before.status, para: status, motivo: reason } }, trx);
    return trx('materials').where({ id }).first();
  });
  res.json({ data: updated });
});

masterDataRouter.put('/materials/:id/plants/:plantId', requirePermission('MM.MATERIAL.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Material');
  const plantId = parseId(req.params.plantId, 'Centro');
  await assertPlant(req, plantId);
  const body = plantDataSchema.parse(req.body);
  const row = await db.transaction(async (trx) => {
    if (!(await trx('materials').where({ id }).first('id'))) throw notFound('Material não encontrado.');
    if (body.default_storage_location_id) await assertSlocInPlant(trx, body.default_storage_location_id, plantId, 'default_storage_location_id');
    const before = await trx('material_plant_data').where({ material_id: id, plant_id: plantId }).forUpdate().first();
    const values = { ...nullify(body), updated_by: req.user.id };
    if (before) await trx('material_plant_data').where({ id: before.id }).update(values);
    else await trx('material_plant_data').insert({ ...values, material_id: id, plant_id: plantId, created_by: req.user.id });
    await audit(req, {
      action: before ? 'UPDATE' : 'CREATE', entity: 'materials', entityId: id, result: 'SUCCESS',
      details: { centro: plantId, ...(before ? { alteracoes: diff(before, body) } : { novo: body }) },
    }, trx);
    return trx('material_plant_data').where({ material_id: id, plant_id: plantId }).first();
  });
  res.json({ data: row });
});

/* ───────────── Fornecedores ───────────── */

masterDataRouter.get('/suppliers', requirePermission('MM.SUPPLIER.READ'), async (req, res) => {
  const f = z.object({ ...pageSchema, q: z.string().trim().max(80).optional(), status: z.enum(STATUSES).optional(), material_id: zId.optional() }).parse(req.query);
  const base = db('suppliers as s').where((qb) => {
    if (f.q) qb.where((w) => w.where('s.code', 'like', like(f.q)).orWhere('s.name', 'like', like(f.q)).orWhere('s.city', 'like', like(f.q)));
    if (f.status) qb.where('s.status', f.status);
    if (f.material_id) qb.whereIn('s.id', db('supplier_materials').where('material_id', f.material_id).select('supplier_id'));
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone().leftJoin('payment_terms as t', 't.id', 's.payment_term_id')
    .select('s.*', 't.code as payment_term_code', 't.name as payment_term_name')
    .orderBy('s.code').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});

masterDataRouter.get('/suppliers/:id', requirePermission('MM.SUPPLIER.READ'), async (req, res) => {
  const id = parseId(req.params.id, 'Fornecedor');
  const supplier = await db('suppliers as s').leftJoin('payment_terms as t', 't.id', 's.payment_term_id')
    .where('s.id', id).first('s.*', 't.code as payment_term_code', 't.name as payment_term_name');
  if (!supplier) throw notFound('Fornecedor não encontrado.');
  const materials = await db('supplier_materials as sm').join('materials as m', 'm.id', 'sm.material_id')
    .where('sm.supplier_id', id)
    .select('sm.material_id', 'm.code', 'm.description', 'm.base_unit', 'm.status', 'sm.net_price', 'sm.lead_time_days', 'sm.supplier_material_code')
    .orderBy('m.code');
  // Histórico de compras: só pedidos dos centros no escopo do usuário.
  const orders = await scopePlants(db('purchase_orders as o'), req, 'o.plant_id')
    .join('plants as p', 'p.id', 'o.plant_id')
    .where('o.supplier_id', id)
    .select('o.id', 'o.number', 'o.status', 'o.total_gross', 'o.currency', 'o.delivery_date', 'o.created_at', 'p.code as plant_code')
    .orderBy('o.id', 'desc').limit(50);
  res.json({ data: { ...supplier, materials, orders, history: await history('suppliers', id) } });
});

masterDataRouter.post('/suppliers', requirePermission('MM.SUPPLIER.CREATE'), async (req, res) => {
  const body = supplierSchema.parse(req.body);
  const created = await db.transaction(async (trx) => {
    const [id] = await trx('suppliers').insert({ ...nullify(body), created_by: req.user.id, updated_by: req.user.id });
    await audit(req, { action: 'CREATE', entity: 'suppliers', entityId: id, result: 'SUCCESS', details: { novo: body } }, trx);
    return trx('suppliers').where({ id }).first();
  });
  res.status(201).json({ data: created });
});

masterDataRouter.put('/suppliers/:id', requirePermission('MM.SUPPLIER.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Fornecedor');
  const body = supplierSchema.parse(req.body);
  const updated = await db.transaction(async (trx) => {
    const before = await trx('suppliers').where({ id }).forUpdate().first();
    if (!before) throw notFound('Fornecedor não encontrado.');
    await trx('suppliers').where({ id }).update({ ...nullify(body), updated_by: req.user.id });
    await audit(req, { action: 'UPDATE', entity: 'suppliers', entityId: id, result: 'SUCCESS', details: { alteracoes: diff(before, body) } }, trx);
    return trx('suppliers').where({ id }).first();
  });
  res.json({ data: updated });
});

masterDataRouter.post('/suppliers/:id/status', requirePermission('MM.SUPPLIER.UPDATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Fornecedor');
  const { status, reason } = statusSchema.parse(req.body);
  const updated = await db.transaction(async (trx) => {
    const before = await trx('suppliers').where({ id }).forUpdate().first('status');
    if (!before) throw notFound('Fornecedor não encontrado.');
    await trx('suppliers').where({ id }).update({ status, updated_by: req.user.id });
    await audit(req, { action: 'STATUS', entity: 'suppliers', entityId: id, result: 'SUCCESS', details: { de: before.status, para: status, motivo: reason } }, trx);
    return trx('suppliers').where({ id }).first();
  });
  res.json({ data: updated });
});

masterDataRouter.put('/suppliers/:id/materials/:materialId', requirePermission('MM.SUPPLIER.UPDATE'), async (req, res) => {
  const supplierId = parseId(req.params.id, 'Fornecedor');
  const materialId = parseId(req.params.materialId, 'Material');
  const body = infoRecordSchema.parse(req.body);
  const row = await db.transaction(async (trx) => {
    if (!(await trx('suppliers').where({ id: supplierId }).first('id'))) throw notFound('Fornecedor não encontrado.');
    if (!(await trx('materials').where({ id: materialId }).first('id'))) throw notFound('Material não encontrado.');
    const before = await trx('supplier_materials').where({ supplier_id: supplierId, material_id: materialId }).forUpdate().first();
    if (before) await trx('supplier_materials').where({ id: before.id }).update({ ...nullify(body), updated_by: req.user.id });
    else await trx('supplier_materials').insert({ ...nullify(body), supplier_id: supplierId, material_id: materialId, created_by: req.user.id, updated_by: req.user.id });
    await audit(req, {
      action: before ? 'UPDATE' : 'CREATE', entity: 'suppliers', entityId: supplierId, result: 'SUCCESS',
      details: { registro_info: materialId, ...(before ? { alteracoes: diff(before, body) } : { novo: body }) },
    }, trx);
    return trx('supplier_materials').where({ supplier_id: supplierId, material_id: materialId }).first();
  });
  res.json({ data: row });
});

masterDataRouter.delete('/suppliers/:id/materials/:materialId', requirePermission('MM.SUPPLIER.UPDATE'), async (req, res) => {
  const supplierId = parseId(req.params.id, 'Fornecedor');
  const materialId = parseId(req.params.materialId, 'Material');
  await db.transaction(async (trx) => {
    const n = await trx('supplier_materials').where({ supplier_id: supplierId, material_id: materialId }).del();
    if (!n) throw notFound('Registro info não encontrado.');
    await audit(req, { action: 'DELETE', entity: 'suppliers', entityId: supplierId, result: 'SUCCESS', details: { registro_info: materialId } }, trx);
  });
  res.status(204).end();
});

masterDataRouter.get('/meta', requirePermission('MM.MATERIAL.READ'), (req, res) => {
  res.json({ data: { materialTypes: MATERIAL_TYPES, units: UNITS } });
});
