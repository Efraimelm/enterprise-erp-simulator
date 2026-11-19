// Pedidos de venda com ATP simplificado, aprovação por valor e reserva de estoque.
//
//   POST /api/sd/atp                              SD.SALES_ORDER.READ     consulta de disponibilidade (não reserva)
//   GET  /api/sd/sales-orders[/:id]               SD.SALES_ORDER.READ
//   POST /api/sd/sales-orders                     SD.SALES_ORDER.CREATE   rascunho com preço, desconto e imposto
//   PUT  /api/sd/sales-orders/:id                 SD.SALES_ORDER.CREATE   só rascunho
//   POST /api/sd/sales-orders/:id/submit          SD.SALES_ORDER.CREATE   até o limite confirma e reserva; acima, aguarda aprovação
//   POST /api/sd/sales-orders/:id/approve         SD.SALES_ORDER.APPROVE  confirma e reserva (quem criou não aprova)
//   POST /api/sd/sales-orders/:id/reject          SD.SALES_ORDER.APPROVE  { reason } → rascunho
//   POST /api/sd/sales-orders/:id/reconfirm       SD.SALES_ORDER.CREATE   tenta reservar o que faltou (atendimento parcial)
//   POST /api/sd/sales-orders/:id/cancel          SD.SALES_ORDER.APPROVE  { reason } libera as reservas (sem entregas)
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, forbidden, HttpError } from '../../lib/errors.js';
import { nextNumber } from '../../lib/numbering.js';
import { money, qty } from '../../lib/numbers.js';
import { withTransaction } from '../../lib/tx.js';
import { requirePermission } from '../../middleware/auth.js';
import { assertMaterialForPlant, assertPlant, assertSlocInPlant, findScoped, history, like, pageSchema, parseId, scopePlants, zDate, zId, zOptText, zQty } from '../mm/common.js';
import { availableQty, releaseStock, reserveStock } from '../mm/stock-service.js';
import { priceItem } from './pricing.js';

export const SO_STATUS = ['DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'IN_DELIVERY', 'PARTIALLY_DELIVERED', 'DELIVERED', 'BILLED', 'CANCELLED'];
const OPEN_FOR_DELIVERY = ['CONFIRMED', 'IN_DELIVERY', 'PARTIALLY_DELIVERED'];
const today = () => new Date().toISOString().slice(0, 10);
const optId = z.preprocess((v) => (v === '' ? null : v), zId.nullable().optional());
const zReason = z.object({ reason: z.string().trim().min(3, 'Informe o motivo.').max(255) }).strict();

export const invalidStatus = (doc, status, action) =>
  new HttpError(409, 'INVALID_STATUS', `Não é possível ${action}: o documento ${doc} está com status ${status}.`);

const soSchema = z.object({
  customer_id: zId,
  sales_organization_id: zId,
  distribution_channel_id: zId,
  division_id: zId,
  plant_id: zId,
  requested_date: zDate,
  allow_partial: z.boolean().default(true),
  customer_reference: zOptText(40),
  notes: zOptText(255),
  items: z.array(z.object({
    item_no: z.coerce.number().int().positive().optional(),
    material_id: zId,
    quantity: zQty,
    storage_location_id: optId,
    tax_code_id: optId,
  }).strict()).min(1, 'Inclua pelo menos um item.').max(100),
}).strict();

/** Valida cabeçalho: cliente ativo e liberado na área de vendas, centro da mesma empresa da organização. */
async function validateHeader(trx, h) {
  const customer = await trx('customers').where({ id: h.customer_id }).first();
  if (!customer) throw badRequest('Cliente inexistente.', [{ field: 'customer_id', message: 'Cliente não encontrado.' }]);
  if (customer.status !== 'ACTIVE') throw badRequest(`O cliente ${customer.code} não está ativo.`, [{ field: 'customer_id', message: 'Cliente bloqueado ou inativo.' }]);
  const area = await trx('sales_areas as a').join('sales_organizations as o', 'o.id', 'a.sales_organization_id')
    .where({ 'a.sales_organization_id': h.sales_organization_id, 'a.distribution_channel_id': h.distribution_channel_id, 'a.division_id': h.division_id, 'a.is_active': true, 'o.is_active': true })
    .first('a.id', 'o.company_id');
  if (!area) throw badRequest('Área de vendas inexistente ou inativa.', [{ field: 'distribution_channel_id', message: 'Combinação organização + canal + setor não cadastrada.' }]);
  if (!(await trx('customer_sales_areas').where({ customer_id: customer.id, sales_area_id: area.id }).first('id'))) {
    throw badRequest(`O cliente ${customer.code} não está liberado para esta área de vendas.`, [{ field: 'customer_id', message: 'Cliente sem a área de vendas.' }]);
  }
  const plant = await trx('plants as p').join('companies as c', 'c.id', 'p.company_id').where('p.id', h.plant_id).first('p.company_id', 'c.currency', 'p.is_active');
  if (!plant || !plant.is_active) throw badRequest('Centro inválido.', [{ field: 'plant_id', message: 'Centro inexistente ou inativo.' }]);
  if (plant.company_id !== area.company_id) throw badRequest('O centro fornecedor precisa ser da mesma empresa da organização de vendas.', [{ field: 'plant_id', message: 'Empresa diferente.' }]);
  const shipTo = [customer.ship_to_street ?? customer.street, customer.ship_to_city ?? customer.city, customer.ship_to_state ?? customer.state, customer.ship_to_zip ?? customer.zip].filter(Boolean).join(', ');
  return { customer, currency: plant.currency, shipTo };
}

async function buildItems(trx, h, items) {
  const defaultTax = (await trx('system_settings').where({ setting_key: 'sd_default_tax_code' }).first('value'))?.value;
  const defaultTaxRow = defaultTax ? await trx('tax_codes').where({ code: defaultTax, is_active: true }).first('id', 'rate') : null;
  const ctx = { salesOrgId: h.sales_organization_id, channelId: h.distribution_channel_id, customerId: h.customer_id, date: today() };
  const rows = [];
  for (const [i, it] of items.entries()) {
    const m = await assertMaterialForPlant(trx, it.material_id, h.plant_id, `items.${i}.material_id`);
    const slocId = it.storage_location_id ?? m.plantData.default_storage_location_id;
    if (!slocId) throw badRequest('Informe o depósito.', [{ field: `items.${i}.storage_location_id`, message: 'Material sem depósito padrão no centro.' }]);
    await assertSlocInPlant(trx, slocId, h.plant_id, `items.${i}.storage_location_id`);
    let taxCodeId = it.tax_code_id === undefined ? defaultTaxRow?.id ?? null : it.tax_code_id;
    let rate = 0;
    if (taxCodeId) {
      const tax = taxCodeId === defaultTaxRow?.id ? defaultTaxRow : await trx('tax_codes').where({ id: taxCodeId, is_active: true }).first('rate');
      if (!tax) throw badRequest('Código de imposto inválido.', [{ field: `items.${i}.tax_code_id`, message: 'Código inexistente ou inativo.' }]);
      rate = Number(tax.rate);
    } else taxCodeId = null;
    const quantity = qty(it.quantity);
    const priced = await priceItem(trx, ctx, { materialId: it.material_id, materialCode: m.code, quantity, taxRate: rate, field: `items.${i}.material_id` });
    rows.push({ item_no: it.item_no ?? (i + 1) * 10, material_id: it.material_id, storage_location_id: slocId, quantity, tax_code_id: taxCodeId, ...priced });
  }
  if (new Set(rows.map((r) => r.item_no)).size !== rows.length) throw badRequest('Número de item repetido.', [{ field: 'items', message: 'Cada item precisa de um número único.' }]);
  const sum = (k) => money(rows.reduce((s, r) => s + r[k], 0));
  const totals = { total_gross_list: sum('list_amount'), total_discount: sum('discount_amount'), total_net: sum('net_amount'), total_tax: sum('tax_amount') };
  totals.total_gross = money(totals.total_net + totals.total_tax);
  return { rows: rows.map(({ list_amount: _, ...r }) => r), totals };
}

/** Recalcula o status do pedido a partir das quantidades (entregue, faturado) e das entregas abertas. */
export async function refreshOrderStatus(trx, soId) {
  const so = await trx('sales_orders').where({ id: soId }).first('status');
  if (!OPEN_FOR_DELIVERY.concat(['DELIVERED', 'BILLED']).includes(so.status)) return so.status;
  const items = await trx('sales_order_items').where({ sales_order_id: soId });
  const total = items.reduce((s, i) => s + i.quantity, 0);
  const delivered = items.reduce((s, i) => s + i.delivered_qty, 0);
  const billed = items.reduce((s, i) => s + i.billed_qty, 0);
  const openDelivery = await trx('deliveries').where({ sales_order_id: soId }).whereNot('status', 'POSTED').first('id');
  let status;
  if (delivered > 0) status = delivered + 1e-9 >= total ? (billed + 1e-9 >= total ? 'BILLED' : 'DELIVERED') : 'PARTIALLY_DELIVERED';
  else status = openDelivery ? 'IN_DELIVERY' : 'CONFIRMED';
  if (status !== so.status) await trx('sales_orders').where({ id: soId }).update({ status });
  return status;
}

/** Confirma o pedido: reserva estoque item a item (ATP). Sem atendimento parcial, falta de estoque desfaz tudo. */
async function confirmOrder(trx, so) {
  const items = await trx('sales_order_items').where({ sales_order_id: so.id }).orderBy('item_no');
  const result = [];
  for (const it of items) {
    const reserved = await reserveStock(trx, {
      materialId: it.material_id, plantId: so.plant_id, storageLocationId: it.storage_location_id,
      quantity: it.quantity, allowPartial: !!so.allow_partial,
    });
    await trx('sales_order_items').where({ id: it.id }).update({ confirmed_qty: reserved });
    result.push({ item: it.item_no, pedido: it.quantity, confirmado: reserved });
  }
  return result;
}

export async function orderDetail(req, id, trx = db) {
  const so = await findScoped(req, 'sales_orders', id, { trx, what: 'Pedido de venda' });
  const [extra] = await trx('sales_orders as o')
    .join('customers as c', 'c.id', 'o.customer_id').join('plants as p', 'p.id', 'o.plant_id')
    .join('sales_organizations as so', 'so.id', 'o.sales_organization_id').join('distribution_channels as ch', 'ch.id', 'o.distribution_channel_id')
    .join('divisions as d', 'd.id', 'o.division_id').leftJoin('payment_terms as t', 't.id', 'o.payment_term_id')
    .join('users as u', 'u.id', 'o.created_by').leftJoin('users as a', 'a.id', 'o.approved_by')
    .where('o.id', id)
    .select('c.code as customer_code', 'c.name as customer_name', 'p.code as plant_code', 'p.name as plant_name', 'so.code as sales_org_code',
      'ch.code as channel_code', 'ch.name as channel_name', 'd.code as division_code', 'd.name as division_name', 't.name as payment_term_name',
      'u.username as created_by_username', 'a.username as approved_by_username');
  const items = await trx('sales_order_items as i').join('materials as m', 'm.id', 'i.material_id').join('storage_locations as s', 's.id', 'i.storage_location_id')
    .leftJoin('tax_codes as t', 't.id', 'i.tax_code_id').where('i.sales_order_id', id)
    .select('i.*', 'm.code as material_code', 'm.description', 'm.base_unit', 's.code as sloc_code', 't.code as tax_code').orderBy('i.item_no');
  const inDelivery = await trx('delivery_items as di').join('deliveries as d', 'd.id', 'di.delivery_id')
    .where('d.sales_order_id', id).whereNot('d.status', 'POSTED').groupBy('di.sales_order_item_id')
    .select('di.sales_order_item_id', trx.raw('SUM(di.quantity) as q'));
  const deliveries = await trx('deliveries').where({ sales_order_id: id }).select('id', 'number', 'status', 'created_at', 'posted_at', 'material_doc_number').orderBy('id');
  const billings = await trx('billing_documents').where({ sales_order_id: id }).select('id', 'number', 'type', 'status', 'billing_date', 'total_gross', 'delivery_id').orderBy('id');
  const receivables = await trx('accounts_receivable as r').join('billing_documents as b', 'b.id', 'r.billing_document_id')
    .where('b.sales_order_id', id).select('r.id', 'b.number', 'r.amount', 'r.paid_amount', 'r.due_date', 'r.status').orderBy('r.id');
  const limit = Number((await trx('system_settings').where({ setting_key: 'so_approval_limit' }).first('value'))?.value ?? 0);
  return {
    ...so, ...extra,
    allow_partial: !!so.allow_partial, auto_approved: !!so.auto_approved,
    items: items.map((i) => {
      const pending = Number(inDelivery.find((x) => x.sales_order_item_id === i.id)?.q ?? 0);
      return {
        ...i,
        open_reserved_qty: qty(i.confirmed_qty - i.delivered_qty),
        unconfirmed_qty: qty(i.quantity - i.confirmed_qty),
        in_delivery_qty: qty(pending),
        deliverable_qty: qty(Math.max(0, i.confirmed_qty - i.delivered_qty - pending)),
      };
    }),
    deliveries, billings, receivables, approval_limit: limit, history: await history('sales_orders', id),
  };
}

export const salesOrdersRouter = Router();

salesOrdersRouter.post('/atp', requirePermission('SD.SALES_ORDER.READ'), async (req, res) => {
  const body = z.object({
    plant_id: zId,
    items: z.array(z.object({ material_id: zId, quantity: zQty, storage_location_id: optId }).strict()).min(1).max(100),
  }).strict().parse(req.body);
  await assertPlant(req, body.plant_id);
  const data = [];
  for (const [i, it] of body.items.entries()) {
    const m = await assertMaterialForPlant(db, it.material_id, body.plant_id, `items.${i}.material_id`);
    const slocId = it.storage_location_id ?? m.plantData.default_storage_location_id;
    const available = slocId ? await availableQty(db, it.material_id, slocId) : 0;
    const confirmable = qty(Math.min(available, it.quantity));
    data.push({ material_id: it.material_id, material_code: m.code, storage_location_id: slocId, requested: it.quantity, available, confirmable, shortfall: qty(it.quantity - confirmable) });
  }
  res.json({ data, meta: { rule: 'disponível = físico − reservado no depósito do item (ATP simplificado, sem datas)' } });
});

salesOrdersRouter.get('/sales-orders', requirePermission('SD.SALES_ORDER.READ'), async (req, res) => {
  const f = z.object({ ...pageSchema, status: z.enum(SO_STATUS).optional(), plant_id: zId.optional(), customer_id: zId.optional(), q: z.string().trim().max(20).optional(), deliverable: z.enum(['true', 'false']).optional() }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);
  const base = scopePlants(db('sales_orders as o'), req, 'o.plant_id').where((qb) => {
    if (f.status) qb.where('o.status', f.status);
    if (f.plant_id) qb.where('o.plant_id', f.plant_id);
    if (f.customer_id) qb.where('o.customer_id', f.customer_id);
    if (f.q) qb.where((w) => w.where('o.number', 'like', like(f.q)).orWhere('o.customer_reference', 'like', like(f.q)));
    if (f.deliverable === 'true') qb.whereIn('o.status', OPEN_FOR_DELIVERY);
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone().join('customers as c', 'c.id', 'o.customer_id').join('plants as p', 'p.id', 'o.plant_id').join('users as u', 'u.id', 'o.created_by')
    .select('o.*', 'c.code as customer_code', 'c.name as customer_name', 'p.code as plant_code', 'u.username as created_by_username',
      db.raw('(SELECT COUNT(*) FROM sales_order_items i WHERE i.sales_order_id = o.id) as item_count'))
    .orderBy('o.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});

salesOrdersRouter.get('/sales-orders/:id', requirePermission('SD.SALES_ORDER.READ'), async (req, res) => {
  res.json({ data: await orderDetail(req, parseId(req.params.id, 'Pedido de venda')) });
});

salesOrdersRouter.post('/sales-orders', requirePermission('SD.SALES_ORDER.CREATE'), async (req, res) => {
  const body = soSchema.parse(req.body);
  await assertPlant(req, body.plant_id);
  const data = await withTransaction(async (trx) => {
    const { customer, currency, shipTo } = await validateHeader(trx, body);
    const { rows, totals } = await buildItems(trx, body, body.items);
    const number = await nextNumber(trx, 'SALES_ORDER');
    const [id] = await trx('sales_orders').insert({
      number, customer_id: body.customer_id, sales_organization_id: body.sales_organization_id, distribution_channel_id: body.distribution_channel_id,
      division_id: body.division_id, plant_id: body.plant_id, payment_term_id: customer.payment_term_id, currency, status: 'DRAFT',
      allow_partial: body.allow_partial, requested_date: body.requested_date, customer_reference: body.customer_reference ?? null, ship_to: shipTo || null,
      notes: body.notes ?? null, ...totals, created_by: req.user.id,
    });
    await trx('sales_order_items').insert(rows.map((r) => ({ ...r, sales_order_id: id })));
    await audit(req, { action: 'CREATE', entity: 'sales_orders', entityId: id, result: 'SUCCESS', details: { numero: number, cliente: customer.code, ...totals } }, trx);
    return orderDetail(req, id, trx);
  });
  res.status(201).json({ data });
});

salesOrdersRouter.put('/sales-orders/:id', requirePermission('SD.SALES_ORDER.CREATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Pedido de venda');
  const body = soSchema.parse(req.body);
  await assertPlant(req, body.plant_id);
  const data = await withTransaction(async (trx) => {
    const so = await findScoped(req, 'sales_orders', id, { trx, lock: true, what: 'Pedido de venda' });
    if (so.status !== 'DRAFT') throw invalidStatus(so.number, so.status, 'alterar (só rascunhos podem ser alterados)');
    const { customer, currency, shipTo } = await validateHeader(trx, body);
    const { rows, totals } = await buildItems(trx, body, body.items);
    await trx('sales_order_items').where({ sales_order_id: id }).del();
    await trx('sales_order_items').insert(rows.map((r) => ({ ...r, sales_order_id: id })));
    await trx('sales_orders').where({ id }).update({
      customer_id: body.customer_id, sales_organization_id: body.sales_organization_id, distribution_channel_id: body.distribution_channel_id,
      division_id: body.division_id, plant_id: body.plant_id, payment_term_id: customer.payment_term_id, currency, allow_partial: body.allow_partial,
      requested_date: body.requested_date, customer_reference: body.customer_reference ?? null, ship_to: shipTo || null, notes: body.notes ?? null, ...totals,
    });
    await audit(req, { action: 'UPDATE', entity: 'sales_orders', entityId: id, result: 'SUCCESS', details: { numero: so.number, de: { total_gross: so.total_gross }, para: totals } }, trx);
    return orderDetail(req, id, trx);
  });
  res.json({ data });
});

async function transition(req, res, { code, label, from, run }) {
  const id = parseId(req.params.id, 'Pedido de venda');
  const data = await withTransaction(async (trx) => {
    const so = await findScoped(req, 'sales_orders', id, { trx, lock: true, what: 'Pedido de venda' });
    if (!from.includes(so.status)) throw invalidStatus(so.number, so.status, label);
    const details = await run(trx, so);
    await audit(req, { action: code, entity: 'sales_orders', entityId: id, result: 'SUCCESS', details: { numero: so.number, de: so.status, ...details } }, trx);
    return orderDetail(req, id, trx);
  });
  res.json({ data });
}

salesOrdersRouter.post('/sales-orders/:id/submit', requirePermission('SD.SALES_ORDER.CREATE'), (req, res) =>
  transition(req, res, {
    code: 'SUBMIT', label: 'enviar', from: ['DRAFT'],
    run: async (trx, so) => {
      const limit = Number((await trx('system_settings').where({ setting_key: 'so_approval_limit' }).first('value'))?.value ?? 0);
      if (Number(so.total_gross) > limit) {
        await trx('sales_orders').where({ id: so.id }).update({ status: 'PENDING_APPROVAL', submitted_at: new Date(), status_note: null });
        return { para: 'PENDING_APPROVAL', limite: limit, total: so.total_gross };
      }
      const atp = await confirmOrder(trx, so);
      await trx('sales_orders').where({ id: so.id }).update({
        status: 'CONFIRMED', submitted_at: new Date(), confirmed_at: new Date(), auto_approved: true, approved_by: null, approved_at: new Date(),
        status_note: `Confirmado sem aprovação (total ≤ limite de ${limit.toFixed(2)})`,
      });
      return { para: 'CONFIRMED', confirmacao_automatica: true, atp };
    },
  }));

salesOrdersRouter.post('/sales-orders/:id/approve', requirePermission('SD.SALES_ORDER.APPROVE'), (req, res) =>
  transition(req, res, {
    code: 'APPROVE', label: 'aprovar', from: ['PENDING_APPROVAL'],
    run: async (trx, so) => {
      if (so.created_by === req.user.id) {
        await audit(req, { action: 'APPROVE', entity: 'sales_orders', entityId: so.id, result: 'DENIED', details: { motivo: 'criador tentou aprovar o próprio pedido' } });
        throw forbidden('Separação de funções: quem criou o pedido de venda não pode aprová-lo.', 'SEGREGATION_OF_DUTIES');
      }
      const atp = await confirmOrder(trx, so);
      await trx('sales_orders').where({ id: so.id }).update({ status: 'CONFIRMED', approved_by: req.user.id, approved_at: new Date(), confirmed_at: new Date(), status_note: null });
      return { para: 'CONFIRMED', atp };
    },
  }));

salesOrdersRouter.post('/sales-orders/:id/reject', requirePermission('SD.SALES_ORDER.APPROVE'), (req, res) => {
  const { reason } = zReason.parse(req.body);
  return transition(req, res, {
    code: 'REJECT', label: 'rejeitar', from: ['PENDING_APPROVAL'],
    run: async (trx, so) => {
      await trx('sales_orders').where({ id: so.id }).update({ status: 'DRAFT', status_note: `Rejeitado: ${reason}` });
      return { para: 'DRAFT', motivo: reason };
    },
  });
});

salesOrdersRouter.post('/sales-orders/:id/reconfirm', requirePermission('SD.SALES_ORDER.CREATE'), (req, res) =>
  transition(req, res, {
    code: 'RECONFIRM', label: 'verificar a disponibilidade de novo', from: OPEN_FOR_DELIVERY,
    run: async (trx, so) => {
      const items = await trx('sales_order_items').where({ sales_order_id: so.id }).whereRaw('confirmed_qty < quantity');
      const result = [];
      for (const it of items) {
        const extra = await reserveStock(trx, { materialId: it.material_id, plantId: so.plant_id, storageLocationId: it.storage_location_id, quantity: qty(it.quantity - it.confirmed_qty), allowPartial: true });
        if (extra > 0) await trx('sales_order_items').where({ id: it.id }).update({ confirmed_qty: qty(it.confirmed_qty + extra) });
        result.push({ item: it.item_no, reservado_agora: extra });
      }
      return { atp: result };
    },
  }));

salesOrdersRouter.post('/sales-orders/:id/cancel', requirePermission('SD.SALES_ORDER.APPROVE'), (req, res) => {
  const { reason } = zReason.parse(req.body);
  return transition(req, res, {
    code: 'CANCEL', label: 'cancelar', from: ['DRAFT', 'PENDING_APPROVAL', 'CONFIRMED'],
    run: async (trx, so) => {
      if (await trx('deliveries').where({ sales_order_id: so.id }).first('id')) {
        throw new HttpError(409, 'HAS_DELIVERIES', 'O pedido tem entregas: exclua as entregas não lançadas antes de cancelar.');
      }
      const items = await trx('sales_order_items').where({ sales_order_id: so.id });
      for (const it of items) {
        await releaseStock(trx, { materialId: it.material_id, plantId: so.plant_id, storageLocationId: it.storage_location_id, quantity: qty(it.confirmed_qty - it.delivered_qty) });
      }
      await trx('sales_order_items').where({ sales_order_id: so.id }).update({ confirmed_qty: 0 });
      await trx('sales_orders').where({ id: so.id }).update({ status: 'CANCELLED', status_note: `Cancelado: ${reason}` });
      return { para: 'CANCELLED', motivo: reason, reservas_liberadas: items.map((i) => ({ item: i.item_no, quantidade: i.confirmed_qty })) };
    },
  });
});
