// Requisições de compra (RC) e pedidos de compra (PC). Regras em docs/mm-design.md.
//
// Requisições                                          permissão
//   GET  /api/mm/purchase-requisitions                    MM.PURCHASE_REQ.READ
//   GET  /api/mm/purchase-requisitions/:id                MM.PURCHASE_REQ.READ
//   POST /api/mm/purchase-requisitions                    MM.PURCHASE_REQ.CREATE
//   POST /api/mm/purchase-requisitions/:id/approve        MM.PURCHASE_REQ.APPROVE   (não pode ser o solicitante)
//   POST /api/mm/purchase-requisitions/:id/reject         MM.PURCHASE_REQ.APPROVE   { reason }
//   POST /api/mm/purchase-requisitions/:id/cancel         solicitante ou aprovador  { reason }
// Pedidos
//   GET  /api/mm/purchase-orders                          MM.PURCHASE_ORDER.READ
//   GET  /api/mm/purchase-orders/:id                      MM.PURCHASE_ORDER.READ
//   POST /api/mm/purchase-orders                          MM.PURCHASE_ORDER.CREATE  (rascunho)
//   POST /api/mm/purchase-orders/from-requisition         MM.PURCHASE_ORDER.CREATE  (RC aprovada → rascunho)
//   PUT  /api/mm/purchase-orders/:id                      MM.PURCHASE_ORDER.CREATE  (só rascunho)
//   POST /api/mm/purchase-orders/:id/submit               MM.PURCHASE_ORDER.CREATE  (aprovação automática até o limite)
//   POST /api/mm/purchase-orders/:id/approve              MM.PURCHASE_ORDER.APPROVE (não pode ser quem criou)
//   POST /api/mm/purchase-orders/:id/reject               MM.PURCHASE_ORDER.APPROVE { reason } → volta a rascunho
//   POST /api/mm/purchase-orders/:id/send                 MM.PURCHASE_ORDER.CREATE  (envio simulado ao fornecedor)
//   POST /api/mm/purchase-orders/:id/cancel               MM.PURCHASE_ORDER.APPROVE { reason } (sem recebimento)
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, forbidden, HttpError } from '../../lib/errors.js';
import { nextNumber } from '../../lib/numbering.js';
import { money, qty } from '../../lib/numbers.js';
import { withTransaction } from '../../lib/tx.js';
import { requirePermission } from '../../middleware/auth.js';
import {
  assertMaterialForPlant, assertPlant, assertSlocInPlant, findScoped, history, like, pageSchema, parseId, scopePlants,
  zDate, zId, zMoney, zOptText, zQty, zText,
} from './common.js';

export const PR_STATUS = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'];
export const PO_STATUS = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];

const invalidStatus = (doc, status, action) =>
  new HttpError(409, 'INVALID_STATUS', `Não é possível ${action}: o documento ${doc} está com status ${status}.`);
const segregation = (what) =>
  forbidden(`Separação de funções: quem criou ${what} não pode aprová-lo(a). Peça a outro aprovador.`, 'SEGREGATION_OF_DUTIES');
const today = () => new Date().toISOString().slice(0, 10);
const zReason = z.object({ reason: z.string().trim().min(3, 'Informe o motivo.').max(255) }).strict();
const optId = z.preprocess((v) => (v === '' ? null : v), zId.nullable().optional());

/* ═════════════ Requisições ═════════════ */

const prSchema = z.object({
  plant_id: zId,
  justification: zText(255, 'Informe a justificativa.'),
  items: z.array(z.object({
    material_id: zId,
    quantity: zQty,
    storage_location_id: optId,
    need_date: zDate.refine((d) => d >= today(), 'A data de necessidade não pode estar no passado.'),
  }).strict()).min(1, 'Inclua pelo menos um item.').max(100),
}).strict();

/** Cria uma requisição (usada pela tela e pelo MRP). Precisa ser chamada dentro de uma transação. */
export async function createRequisition(trx, { plantId, requesterId, source, justification, items }) {
  const rows = [];
  for (const [i, it] of items.entries()) {
    const m = await assertMaterialForPlant(trx, it.material_id, plantId, `items.${i}.material_id`);
    const slocId = it.storage_location_id ?? m.plantData.default_storage_location_id;
    if (slocId) await assertSlocInPlant(trx, slocId, plantId, `items.${i}.storage_location_id`);
    const best = await trx('supplier_materials as sm').join('suppliers as s', 's.id', 'sm.supplier_id')
      .where({ 'sm.material_id': it.material_id, 's.status': 'ACTIVE' }).min({ p: 'sm.net_price' }).first();
    rows.push({
      item_no: (i + 1) * 10,
      material_id: it.material_id,
      storage_location_id: slocId ?? null,
      quantity: qty(it.quantity),
      need_date: it.need_date,
      estimated_price: money(best?.p ?? m.reference_price),
    });
  }
  const number = await nextNumber(trx, 'PURCHASE_REQ');
  const [id] = await trx('purchase_requisitions').insert({ number, plant_id: plantId, requester_id: requesterId, source, status: 'PENDING_APPROVAL', justification });
  await trx('purchase_requisition_items').insert(rows.map((r) => ({ ...r, requisition_id: id })));
  return { id, number };
}

async function requisitionDetail(req, id, trx = db) {
  const pr = await findScoped(req, 'purchase_requisitions', id, { trx, what: 'Requisição' });
  const [extra] = await trx('purchase_requisitions as r')
    .join('plants as p', 'p.id', 'r.plant_id').join('users as u', 'u.id', 'r.requester_id').leftJoin('users as d', 'd.id', 'r.decided_by')
    .where('r.id', id).select('p.code as plant_code', 'p.name as plant_name', 'u.username as requester', 'u.full_name as requester_name', 'd.username as decided_by_username');
  const items = await trx('purchase_requisition_items as i')
    .join('materials as m', 'm.id', 'i.material_id')
    .leftJoin('storage_locations as s', 's.id', 'i.storage_location_id')
    .leftJoin('purchase_order_items as poi', 'poi.id', 'i.purchase_order_item_id')
    .leftJoin('purchase_orders as po', 'po.id', 'poi.purchase_order_id')
    .where('i.requisition_id', id)
    .select('i.*', 'm.code as material_code', 'm.description', 'm.base_unit', 's.code as sloc_code', 'po.id as purchase_order_id', 'po.number as purchase_order_number')
    .orderBy('i.item_no');
  const estimated_total = money(items.reduce((s, i) => s + i.quantity * i.estimated_price, 0));
  return { ...pr, ...extra, items, estimated_total, history: await history('purchase_requisitions', id) };
}

export const purchasingRouter = Router();

purchasingRouter.get('/purchase-requisitions', requirePermission('MM.PURCHASE_REQ.READ'), async (req, res) => {
  const f = z.object({
    ...pageSchema, status: z.enum(PR_STATUS).optional(), plant_id: zId.optional(), source: z.enum(['MANUAL', 'MRP']).optional(),
    mine: z.enum(['true', 'false']).optional(), q: z.string().trim().max(20).optional(),
  }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);
  const base = scopePlants(db('purchase_requisitions as r'), req, 'r.plant_id').where((qb) => {
    if (f.status) qb.where('r.status', f.status);
    if (f.plant_id) qb.where('r.plant_id', f.plant_id);
    if (f.source) qb.where('r.source', f.source);
    if (f.mine === 'true') qb.where('r.requester_id', req.user.id);
    if (f.q) qb.where('r.number', 'like', like(f.q));
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone()
    .join('plants as p', 'p.id', 'r.plant_id').join('users as u', 'u.id', 'r.requester_id')
    .select('r.*', 'p.code as plant_code', 'u.username as requester',
      db.raw('(SELECT COUNT(*) FROM purchase_requisition_items i WHERE i.requisition_id = r.id) as item_count'),
      db.raw('(SELECT COALESCE(SUM(i.quantity * i.estimated_price), 0) FROM purchase_requisition_items i WHERE i.requisition_id = r.id) as estimated_total'))
    .orderBy('r.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data: data.map((r) => ({ ...r, estimated_total: money(r.estimated_total) })), page: f.page, pageSize: f.pageSize, total: Number(total) });
});

purchasingRouter.get('/purchase-requisitions/:id', requirePermission('MM.PURCHASE_REQ.READ'), async (req, res) => {
  res.json({ data: await requisitionDetail(req, parseId(req.params.id, 'Requisição')) });
});

purchasingRouter.post('/purchase-requisitions', requirePermission('MM.PURCHASE_REQ.CREATE'), async (req, res) => {
  const body = prSchema.parse(req.body);
  await assertPlant(req, body.plant_id);
  const created = await withTransaction(async (trx) => {
    const pr = await createRequisition(trx, { plantId: body.plant_id, requesterId: req.user.id, source: 'MANUAL', justification: body.justification, items: body.items });
    await audit(req, { action: 'CREATE', entity: 'purchase_requisitions', entityId: pr.id, result: 'SUCCESS', details: { numero: pr.number, itens: body.items.length } }, trx);
    return requisitionDetail(req, pr.id, trx);
  });
  res.status(201).json({ data: created });
});

async function decideRequisition(req, res, decision) {
  const id = parseId(req.params.id, 'Requisição');
  const reason = decision === 'APPROVED' ? null : zReason.parse(req.body).reason;
  const data = await withTransaction(async (trx) => {
    const pr = await findScoped(req, 'purchase_requisitions', id, { trx, lock: true, what: 'Requisição' });
    if (pr.status !== 'PENDING_APPROVAL') throw invalidStatus(pr.number, pr.status, decision === 'APPROVED' ? 'aprovar' : 'rejeitar');
    if (pr.requester_id === req.user.id) {
      await audit(req, { action: 'APPROVE', entity: 'purchase_requisitions', entityId: id, result: 'DENIED', details: { motivo: 'solicitante tentou decidir a própria requisição' } });
      throw segregation('a requisição');
    }
    await trx('purchase_requisitions').where({ id }).update({ status: decision, decided_by: req.user.id, decided_at: new Date(), decision_note: reason });
    await audit(req, { action: decision === 'APPROVED' ? 'APPROVE' : 'REJECT', entity: 'purchase_requisitions', entityId: id, result: 'SUCCESS', details: { numero: pr.number, motivo: reason } }, trx);
    return requisitionDetail(req, id, trx);
  });
  res.json({ data });
}

purchasingRouter.post('/purchase-requisitions/:id/approve', requirePermission('MM.PURCHASE_REQ.APPROVE'), (req, res) => decideRequisition(req, res, 'APPROVED'));
purchasingRouter.post('/purchase-requisitions/:id/reject', requirePermission('MM.PURCHASE_REQ.APPROVE'), (req, res) => decideRequisition(req, res, 'REJECTED'));

purchasingRouter.post('/purchase-requisitions/:id/cancel', requirePermission('MM.PURCHASE_REQ.READ'), async (req, res) => {
  const id = parseId(req.params.id, 'Requisição');
  const { reason } = zReason.parse(req.body);
  const data = await withTransaction(async (trx) => {
    const pr = await findScoped(req, 'purchase_requisitions', id, { trx, lock: true, what: 'Requisição' });
    const allowed = pr.requester_id === req.user.id || req.user.permissions.has('MM.PURCHASE_REQ.APPROVE');
    if (!allowed) throw forbidden('Só o solicitante ou um aprovador pode cancelar a requisição.');
    if (!['PENDING_APPROVAL', 'APPROVED'].includes(pr.status)) throw invalidStatus(pr.number, pr.status, 'cancelar');
    await trx('purchase_requisitions').where({ id }).update({ status: 'CANCELLED', decided_by: req.user.id, decided_at: new Date(), decision_note: reason });
    await audit(req, { action: 'CANCEL', entity: 'purchase_requisitions', entityId: id, result: 'SUCCESS', details: { numero: pr.number, motivo: reason } }, trx);
    return requisitionDetail(req, id, trx);
  });
  res.json({ data });
});

/* ═════════════ Pedidos de compra ═════════════ */

const poItem = z.object({
  item_no: z.coerce.number().int().positive().optional(),
  material_id: zId,
  quantity: zQty,
  unit_price: z.preprocess((v) => (v === '' || v === null ? undefined : v), zMoney.optional()),
  tax_code_id: optId,
  storage_location_id: optId,
}).strict();

const poSchema = z.object({
  supplier_id: zId,
  purchasing_organization_id: zId,
  purchasing_group_id: optId,
  plant_id: zId,
  payment_term_id: optId,
  delivery_date: zDate,
  notes: zOptText(255),
  items: z.array(poItem).min(1, 'Inclua pelo menos um item.').max(100),
}).strict();

const fromRequisitionSchema = z.object({
  requisition_id: zId,
  supplier_id: zId,
  purchasing_organization_id: zId,
  purchasing_group_id: optId,
  tax_code_id: optId,
  delivery_date: zDate.optional(),
}).strict();

/** Valida o cabeçalho do pedido e devolve fornecedor, moeda e condição de pagamento. */
async function validateHeader(trx, h) {
  const supplier = await trx('suppliers').where({ id: h.supplier_id }).first();
  if (!supplier) throw badRequest('Fornecedor inexistente.', [{ field: 'supplier_id', message: 'Fornecedor não encontrado.' }]);
  if (supplier.status !== 'ACTIVE') throw badRequest(`O fornecedor ${supplier.code} não está ativo.`, [{ field: 'supplier_id', message: 'Fornecedor bloqueado ou inativo.' }]);
  const assigned = await trx('purchasing_org_plants as op').join('purchasing_organizations as o', 'o.id', 'op.purchasing_organization_id')
    .where({ 'op.purchasing_organization_id': h.purchasing_organization_id, 'op.plant_id': h.plant_id, 'op.is_active': true, 'o.is_active': true }).first('o.id');
  if (!assigned) throw badRequest('A organização de compras não atende este centro.', [{ field: 'purchasing_organization_id', message: 'Organização de compras não atribuída ao centro.' }]);
  if (h.purchasing_group_id && !(await trx('purchasing_groups').where({ id: h.purchasing_group_id, is_active: true }).first('id'))) {
    throw badRequest('Grupo de compradores inválido.', [{ field: 'purchasing_group_id', message: 'Grupo inexistente ou inativo.' }]);
  }
  const plant = await trx('plants as p').join('companies as c', 'c.id', 'p.company_id').where('p.id', h.plant_id).first('c.currency');
  const paymentTermId = h.payment_term_id ?? supplier.payment_term_id ?? null;
  if (paymentTermId && !(await trx('payment_terms').where({ id: paymentTermId, is_active: true }).first('id'))) {
    throw badRequest('Condição de pagamento inválida.', [{ field: 'payment_term_id', message: 'Condição inexistente ou inativa.' }]);
  }
  return { supplier, currency: plant.currency, paymentTermId };
}

/** Calcula os itens (preço sugerido, imposto simulado, valores) e os totais. */
async function buildItems(trx, h, items) {
  const rows = [];
  for (const [i, it] of items.entries()) {
    const m = await assertMaterialForPlant(trx, it.material_id, h.plant_id, `items.${i}.material_id`);
    const slocId = it.storage_location_id ?? m.plantData.default_storage_location_id;
    if (!slocId) throw badRequest('Informe o depósito.', [{ field: `items.${i}.storage_location_id`, message: 'Material sem depósito padrão no centro.' }]);
    await assertSlocInPlant(trx, slocId, h.plant_id, `items.${i}.storage_location_id`);
    let unitPrice = it.unit_price;
    if (unitPrice === undefined) {
      const info = await trx('supplier_materials').where({ supplier_id: h.supplier_id, material_id: it.material_id }).first('net_price');
      unitPrice = info?.net_price ?? m.reference_price;
    }
    let rate = 0;
    if (it.tax_code_id) {
      const tax = await trx('tax_codes').where({ id: it.tax_code_id, is_active: true }).first('rate');
      if (!tax) throw badRequest('Código de imposto inválido.', [{ field: `items.${i}.tax_code_id`, message: 'Código inexistente ou inativo.' }]);
      rate = Number(tax.rate);
    }
    const quantity = qty(it.quantity);
    const net = money(quantity * unitPrice);
    rows.push({
      item_no: it.item_no ?? (i + 1) * 10,
      material_id: it.material_id,
      storage_location_id: slocId,
      quantity,
      unit_price: money(unitPrice),
      tax_code_id: it.tax_code_id ?? null,
      tax_rate: rate,
      net_amount: net,
      tax_amount: money((net * rate) / 100),
    });
  }
  if (new Set(rows.map((r) => r.item_no)).size !== rows.length) throw badRequest('Número de item repetido.', [{ field: 'items', message: 'Cada item precisa de um número único.' }]);
  const total_net = money(rows.reduce((s, r) => s + r.net_amount, 0));
  const total_tax = money(rows.reduce((s, r) => s + r.tax_amount, 0));
  return { rows, totals: { total_net, total_tax, total_gross: money(total_net + total_tax) } };
}

async function orderDetail(req, id, trx = db) {
  const po = await findScoped(req, 'purchase_orders', id, { trx, what: 'Pedido de compra' });
  const [extra] = await trx('purchase_orders as o')
    .join('suppliers as s', 's.id', 'o.supplier_id')
    .join('plants as p', 'p.id', 'o.plant_id')
    .join('purchasing_organizations as org', 'org.id', 'o.purchasing_organization_id')
    .leftJoin('purchasing_groups as g', 'g.id', 'o.purchasing_group_id')
    .leftJoin('payment_terms as t', 't.id', 'o.payment_term_id')
    .join('users as c', 'c.id', 'o.created_by')
    .leftJoin('users as a', 'a.id', 'o.approved_by')
    .where('o.id', id)
    .select('s.code as supplier_code', 's.name as supplier_name', 's.overdelivery_tolerance_pct', 'p.code as plant_code', 'p.name as plant_name',
      'org.code as purchasing_org_code', 'g.code as purchasing_group_code', 't.code as payment_term_code', 't.name as payment_term_name',
      'c.username as created_by_username', 'a.username as approved_by_username');
  const items = await trx('purchase_order_items as i')
    .join('materials as m', 'm.id', 'i.material_id')
    .join('storage_locations as sl', 'sl.id', 'i.storage_location_id')
    .leftJoin('tax_codes as tc', 'tc.id', 'i.tax_code_id')
    .where('i.purchase_order_id', id)
    .select('i.*', 'm.code as material_code', 'm.description', 'm.base_unit', 'sl.code as sloc_code', 'tc.code as tax_code')
    .orderBy('i.item_no');
  const requisitions = await trx('purchase_requisition_items as ri')
    .join('purchase_requisitions as r', 'r.id', 'ri.requisition_id')
    .whereIn('ri.purchase_order_item_id', items.map((i) => i.id).concat(0))
    .distinct('r.id', 'r.number', 'r.status');
  const receipts = await trx('goods_receipts as g').join('users as u', 'u.id', 'g.posted_by')
    .where('g.purchase_order_id', id).select('g.id', 'g.doc_number', 'g.posted_at', 'g.notes', 'u.username as posted_by_username').orderBy('g.id');
  const limit = Number((await trx('system_settings').where({ setting_key: 'po_approval_limit' }).first('value'))?.value ?? 0);
  return {
    ...po, ...extra,
    auto_approved: !!po.auto_approved,
    items: items.map((i) => ({ ...i, open_qty: qty(Math.max(0, i.quantity - i.received_qty)) })),
    requisitions, receipts, approval_limit: limit, history: await history('purchase_orders', id),
  };
}

async function linkRequisitionItems(trx, links) {
  for (const [poItemId, prItemIds] of links) {
    await trx('purchase_requisition_items').whereIn('id', prItemIds).update({ purchase_order_item_id: poItemId });
  }
}

async function insertOrderItems(trx, poId, rows) {
  const links = [];
  for (const { requisition_item_ids: prItems, ...row } of rows) {
    const [itemId] = await trx('purchase_order_items').insert({ ...row, purchase_order_id: poId });
    if (prItems?.length) links.push([itemId, prItems]);
  }
  await linkRequisitionItems(trx, links);
}

purchasingRouter.get('/purchase-orders', requirePermission('MM.PURCHASE_ORDER.READ'), async (req, res) => {
  const f = z.object({
    ...pageSchema, status: z.enum(PO_STATUS).optional(), plant_id: zId.optional(), supplier_id: zId.optional(),
    q: z.string().trim().max(20).optional(), open_for_receipt: z.enum(['true', 'false']).optional(),
  }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);
  const base = scopePlants(db('purchase_orders as o'), req, 'o.plant_id').where((qb) => {
    if (f.status) qb.where('o.status', f.status);
    if (f.plant_id) qb.where('o.plant_id', f.plant_id);
    if (f.supplier_id) qb.where('o.supplier_id', f.supplier_id);
    if (f.q) qb.where('o.number', 'like', like(f.q));
    if (f.open_for_receipt === 'true') qb.whereIn('o.status', ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED']);
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone()
    .join('suppliers as s', 's.id', 'o.supplier_id').join('plants as p', 'p.id', 'o.plant_id').join('users as u', 'u.id', 'o.created_by')
    .select('o.*', 's.code as supplier_code', 's.name as supplier_name', 'p.code as plant_code', 'u.username as created_by_username',
      db.raw('(SELECT COUNT(*) FROM purchase_order_items i WHERE i.purchase_order_id = o.id) as item_count'))
    .orderBy('o.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});

purchasingRouter.get('/purchase-orders/:id', requirePermission('MM.PURCHASE_ORDER.READ'), async (req, res) => {
  res.json({ data: await orderDetail(req, parseId(req.params.id, 'Pedido de compra')) });
});

purchasingRouter.post('/purchase-orders', requirePermission('MM.PURCHASE_ORDER.CREATE'), async (req, res) => {
  const body = poSchema.parse(req.body);
  await assertPlant(req, body.plant_id);
  const data = await withTransaction(async (trx) => {
    const { currency, paymentTermId } = await validateHeader(trx, body);
    const { rows, totals } = await buildItems(trx, body, body.items);
    const number = await nextNumber(trx, 'PURCHASE_ORDER');
    const [id] = await trx('purchase_orders').insert({
      number, supplier_id: body.supplier_id, purchasing_organization_id: body.purchasing_organization_id, purchasing_group_id: body.purchasing_group_id ?? null,
      plant_id: body.plant_id, payment_term_id: paymentTermId, currency, status: 'DRAFT', delivery_date: body.delivery_date, notes: body.notes ?? null,
      ...totals, created_by: req.user.id,
    });
    await insertOrderItems(trx, id, rows);
    await audit(req, { action: 'CREATE', entity: 'purchase_orders', entityId: id, result: 'SUCCESS', details: { numero: number, ...totals } }, trx);
    return orderDetail(req, id, trx);
  });
  res.status(201).json({ data });
});

purchasingRouter.post('/purchase-orders/from-requisition', requirePermission('MM.PURCHASE_ORDER.CREATE'), async (req, res) => {
  const body = fromRequisitionSchema.parse(req.body);
  const data = await withTransaction(async (trx) => {
    const pr = await findScoped(req, 'purchase_requisitions', body.requisition_id, { trx, lock: true, what: 'Requisição' });
    if (pr.status !== 'APPROVED') throw invalidStatus(pr.number, pr.status, 'converter em pedido (precisa estar aprovada)');
    const prItems = await trx('purchase_requisition_items').where({ requisition_id: pr.id }).orderBy('item_no');
    const header = {
      ...body, plant_id: pr.plant_id,
      delivery_date: body.delivery_date ?? prItems.map((i) => i.need_date).sort().at(-1),
    };
    const { currency, paymentTermId } = await validateHeader(trx, header);
    const { rows, totals } = await buildItems(trx, header, prItems.map((i) => ({
      item_no: i.item_no, material_id: i.material_id, quantity: i.quantity, storage_location_id: i.storage_location_id, tax_code_id: body.tax_code_id,
    })));
    rows.forEach((r, i) => { r.requisition_item_ids = [prItems[i].id]; });
    const number = await nextNumber(trx, 'PURCHASE_ORDER');
    const [id] = await trx('purchase_orders').insert({
      number, supplier_id: body.supplier_id, purchasing_organization_id: body.purchasing_organization_id, purchasing_group_id: body.purchasing_group_id ?? null,
      plant_id: pr.plant_id, payment_term_id: paymentTermId, currency, status: 'DRAFT', delivery_date: header.delivery_date,
      notes: `Criado a partir da requisição ${pr.number}`, ...totals, created_by: req.user.id,
    });
    await insertOrderItems(trx, id, rows);
    await trx('purchase_requisitions').where({ id: pr.id }).update({ status: 'CONVERTED' });
    await audit(req, { action: 'CONVERT', entity: 'purchase_requisitions', entityId: pr.id, result: 'SUCCESS', details: { requisicao: pr.number, pedido: number } }, trx);
    await audit(req, { action: 'CREATE', entity: 'purchase_orders', entityId: id, result: 'SUCCESS', details: { numero: number, origem: pr.number, ...totals } }, trx);
    return orderDetail(req, id, trx);
  });
  res.status(201).json({ data });
});

purchasingRouter.put('/purchase-orders/:id', requirePermission('MM.PURCHASE_ORDER.CREATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Pedido de compra');
  const body = poSchema.parse(req.body);
  await assertPlant(req, body.plant_id);
  const data = await withTransaction(async (trx) => {
    const po = await findScoped(req, 'purchase_orders', id, { trx, lock: true, what: 'Pedido de compra' });
    if (po.status !== 'DRAFT') throw invalidStatus(po.number, po.status, 'alterar (só rascunhos podem ser alterados)');
    const { currency, paymentTermId } = await validateHeader(trx, body);
    const { rows, totals } = await buildItems(trx, body, body.items);
    // Preserva o vínculo com a requisição pelo número do item.
    const oldLinks = await trx('purchase_order_items as i').join('purchase_requisition_items as r', 'r.purchase_order_item_id', 'i.id')
      .where('i.purchase_order_id', id).select('i.item_no', 'r.id as pr_item_id');
    for (const r of rows) r.requisition_item_ids = oldLinks.filter((l) => l.item_no === r.item_no).map((l) => l.pr_item_id);
    await trx('purchase_order_items').where({ purchase_order_id: id }).del();
    await insertOrderItems(trx, id, rows);
    await trx('purchase_orders').where({ id }).update({
      supplier_id: body.supplier_id, purchasing_organization_id: body.purchasing_organization_id, purchasing_group_id: body.purchasing_group_id ?? null,
      plant_id: body.plant_id, payment_term_id: paymentTermId, currency, delivery_date: body.delivery_date, notes: body.notes ?? null, ...totals,
    });
    await audit(req, { action: 'UPDATE', entity: 'purchase_orders', entityId: id, result: 'SUCCESS', details: { numero: po.number, de: { total_gross: po.total_gross }, para: totals } }, trx);
    return orderDetail(req, id, trx);
  });
  res.json({ data });
});

/** Executa uma transição de status do pedido com trava, escopo e auditoria. */
async function transition(req, res, { action, from, run }) {
  const id = parseId(req.params.id, 'Pedido de compra');
  const data = await withTransaction(async (trx) => {
    const po = await findScoped(req, 'purchase_orders', id, { trx, lock: true, what: 'Pedido de compra' });
    if (!from.includes(po.status)) throw invalidStatus(po.number, po.status, action.label);
    const details = await run(trx, po);
    await audit(req, { action: action.code, entity: 'purchase_orders', entityId: id, result: 'SUCCESS', details: { numero: po.number, de: po.status, ...details } }, trx);
    return orderDetail(req, id, trx);
  });
  res.json({ data });
}

purchasingRouter.post('/purchase-orders/:id/submit', requirePermission('MM.PURCHASE_ORDER.CREATE'), (req, res) =>
  transition(req, res, {
    action: { code: 'SUBMIT', label: 'enviar para aprovação' },
    from: ['DRAFT'],
    run: async (trx, po) => {
      const limit = Number((await trx('system_settings').where({ setting_key: 'po_approval_limit' }).first('value'))?.value ?? 0);
      const auto = Number(po.total_gross) <= limit;
      await trx('purchase_orders').where({ id: po.id }).update({
        status: auto ? 'APPROVED' : 'PENDING_APPROVAL', submitted_at: new Date(), auto_approved: auto,
        approved_at: auto ? new Date() : null, approved_by: null, status_note: auto ? `Aprovado automaticamente (total ≤ limite de ${limit.toFixed(2)})` : null,
      });
      return { para: auto ? 'APPROVED' : 'PENDING_APPROVAL', aprovacao_automatica: auto, limite: limit, total: po.total_gross };
    },
  }));

purchasingRouter.post('/purchase-orders/:id/approve', requirePermission('MM.PURCHASE_ORDER.APPROVE'), (req, res) =>
  transition(req, res, {
    action: { code: 'APPROVE', label: 'aprovar' },
    from: ['PENDING_APPROVAL'],
    run: async (trx, po) => {
      if (po.created_by === req.user.id) {
        await audit(req, { action: 'APPROVE', entity: 'purchase_orders', entityId: po.id, result: 'DENIED', details: { motivo: 'criador tentou aprovar o próprio pedido' } });
        throw segregation('o pedido');
      }
      await trx('purchase_orders').where({ id: po.id }).update({ status: 'APPROVED', approved_by: req.user.id, approved_at: new Date(), status_note: null });
      return { para: 'APPROVED' };
    },
  }));

purchasingRouter.post('/purchase-orders/:id/reject', requirePermission('MM.PURCHASE_ORDER.APPROVE'), (req, res) => {
  const { reason } = zReason.parse(req.body);
  return transition(req, res, {
    action: { code: 'REJECT', label: 'rejeitar' },
    from: ['PENDING_APPROVAL'],
    run: async (trx, po) => {
      await trx('purchase_orders').where({ id: po.id }).update({ status: 'DRAFT', status_note: `Rejeitado: ${reason}` });
      return { para: 'DRAFT', motivo: reason };
    },
  });
});

purchasingRouter.post('/purchase-orders/:id/send', requirePermission('MM.PURCHASE_ORDER.CREATE'), (req, res) =>
  transition(req, res, {
    action: { code: 'SEND', label: 'enviar ao fornecedor' },
    from: ['APPROVED'],
    run: async (trx, po) => {
      await trx('purchase_orders').where({ id: po.id }).update({ status: 'SENT', sent_at: new Date() });
      return { para: 'SENT', observacao: 'Envio simulado: nenhuma mensagem é enviada de verdade.' };
    },
  }));

purchasingRouter.post('/purchase-orders/:id/cancel', requirePermission('MM.PURCHASE_ORDER.APPROVE'), (req, res) => {
  const { reason } = zReason.parse(req.body);
  return transition(req, res, {
    action: { code: 'CANCEL', label: 'cancelar' },
    from: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'],
    run: async (trx, po) => {
      const received = await trx('purchase_order_items').where({ purchase_order_id: po.id }).where('received_qty', '>', 0).first('id');
      if (received) throw new HttpError(409, 'HAS_RECEIPTS', 'Pedido com recebimento não pode ser cancelado.');
      // Libera as requisições de origem para serem convertidas de novo.
      const itemIds = await trx('purchase_order_items').where({ purchase_order_id: po.id }).pluck('id');
      const prIds = await trx('purchase_requisition_items').whereIn('purchase_order_item_id', itemIds.concat(0)).distinct().pluck('requisition_id');
      await trx('purchase_requisition_items').whereIn('purchase_order_item_id', itemIds.concat(0)).update({ purchase_order_item_id: null });
      if (prIds.length) await trx('purchase_requisitions').whereIn('id', prIds).where({ status: 'CONVERTED' }).update({ status: 'APPROVED' });
      await trx('purchase_orders').where({ id: po.id }).update({ status: 'CANCELLED', status_note: `Cancelado: ${reason}` });
      return { para: 'CANCELLED', motivo: reason, requisicoes_liberadas: prIds.length };
    },
  });
});
