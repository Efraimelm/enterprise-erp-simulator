// Entregas: criação a partir do pedido confirmado, separação (picking) e saída de mercadoria (601).
//
//   GET    /api/sd/deliveries[/:id]                   SD.SALES_ORDER.READ
//   POST   /api/sd/deliveries                         SD.DELIVERY.CREATE  { sales_order_id, items: [{ sales_order_item_id, quantity }] }
//   POST   /api/sd/deliveries/:id/pick                SD.DELIVERY.CREATE  { items: [{ delivery_item_id, picked_qty }] }
//   POST   /api/sd/deliveries/:id/post-goods-issue    SD.DELIVERY.CREATE  baixa estoque (601), consome a reserva
//   DELETE /api/sd/deliveries/:id                     SD.DELIVERY.CREATE  só entrega não lançada
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest } from '../../lib/errors.js';
import { nextNumber } from '../../lib/numbering.js';
import { qty } from '../../lib/numbers.js';
import { withTransaction } from '../../lib/tx.js';
import { requirePermission } from '../../middleware/auth.js';
import { assertPlant, findScoped, pageSchema, parseId, scopePlants, zId, zQty } from '../mm/common.js';
import { postMaterialDocument } from '../mm/stock-service.js';
import { invalidStatus, refreshOrderStatus } from './sales-orders.js';

const OPEN_FOR_DELIVERY = ['CONFIRMED', 'IN_DELIVERY', 'PARTIALLY_DELIVERED'];

async function deliveryDetail(req, id, trx = db) {
  const d = await findScoped(req, 'deliveries', id, { trx, what: 'Entrega' });
  const [extra] = await trx('deliveries as d').join('sales_orders as o', 'o.id', 'd.sales_order_id').join('customers as c', 'c.id', 'o.customer_id')
    .join('plants as p', 'p.id', 'd.plant_id').join('users as u', 'u.id', 'd.created_by')
    .leftJoin('users as pk', 'pk.id', 'd.picked_by').leftJoin('users as ps', 'ps.id', 'd.posted_by')
    .where('d.id', id)
    .select('o.number as sales_order_number', 'o.status as sales_order_status', 'c.code as customer_code', 'c.name as customer_name', 'p.code as plant_code',
      'u.username as created_by_username', 'pk.username as picked_by_username', 'ps.username as posted_by_username');
  const items = await trx('delivery_items as di').join('sales_order_items as si', 'si.id', 'di.sales_order_item_id')
    .join('materials as m', 'm.id', 'di.material_id').join('storage_locations as s', 's.id', 'di.storage_location_id')
    .where('di.delivery_id', id)
    .select('di.*', 'si.item_no as so_item_no', 'm.code as material_code', 'm.description', 'm.base_unit', 's.code as sloc_code').orderBy('si.item_no');
  const billing = await trx('billing_documents').where({ delivery_id: id }).select('id', 'number', 'type', 'status', 'total_gross').orderBy('id');
  return { ...d, ...extra, items, billing };
}

export const deliveriesRouter = Router();

deliveriesRouter.get('/deliveries', requirePermission('SD.SALES_ORDER.READ'), async (req, res) => {
  const f = z.object({ ...pageSchema, status: z.enum(['CREATED', 'PICKED', 'POSTED']).optional(), plant_id: zId.optional(), sales_order_id: zId.optional(), unbilled: z.enum(['true', 'false']).optional() }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);
  const base = scopePlants(db('deliveries as d'), req, 'd.plant_id').where((qb) => {
    if (f.status) qb.where('d.status', f.status);
    if (f.plant_id) qb.where('d.plant_id', f.plant_id);
    if (f.sales_order_id) qb.where('d.sales_order_id', f.sales_order_id);
    if (f.unbilled === 'true') {
      qb.where('d.status', 'POSTED').whereNotExists(db('billing_documents as b').whereRaw('b.delivery_id = d.id').where({ 'b.type': 'INVOICE', 'b.status': 'ACTIVE' }).select(db.raw(1)));
    }
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone().join('sales_orders as o', 'o.id', 'd.sales_order_id').join('customers as c', 'c.id', 'o.customer_id').join('plants as p', 'p.id', 'd.plant_id')
    .select('d.*', 'o.number as sales_order_number', 'c.name as customer_name', 'p.code as plant_code',
      db.raw('(SELECT COALESCE(SUM(COALESCE(di.picked_qty, di.quantity)), 0) FROM delivery_items di WHERE di.delivery_id = d.id) as total_qty'),
      db.raw("(SELECT b.number FROM billing_documents b WHERE b.delivery_id = d.id AND b.type = 'INVOICE' AND b.status = 'ACTIVE' LIMIT 1) as billing_number"))
    .orderBy('d.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});

deliveriesRouter.get('/deliveries/:id', requirePermission('SD.SALES_ORDER.READ'), async (req, res) => {
  res.json({ data: await deliveryDetail(req, parseId(req.params.id, 'Entrega')) });
});

deliveriesRouter.post('/deliveries', requirePermission('SD.DELIVERY.CREATE'), async (req, res) => {
  const body = z.object({
    sales_order_id: zId,
    items: z.array(z.object({ sales_order_item_id: zId, quantity: zQty }).strict()).min(1, 'Informe pelo menos um item.').max(100),
  }).strict().parse(req.body);
  const data = await withTransaction(async (trx) => {
    const so = await findScoped(req, 'sales_orders', body.sales_order_id, { trx, lock: true, what: 'Pedido de venda' });
    if (!OPEN_FOR_DELIVERY.includes(so.status)) throw invalidStatus(so.number, so.status, 'criar entrega (o pedido precisa estar confirmado)');
    const soItems = await trx('sales_order_items').where({ sales_order_id: so.id });
    const pending = await trx('delivery_items as di').join('deliveries as d', 'd.id', 'di.delivery_id')
      .where('d.sales_order_id', so.id).whereNot('d.status', 'POSTED').groupBy('di.sales_order_item_id').select('di.sales_order_item_id', trx.raw('SUM(di.quantity) as q'));
    const rows = [];
    for (const [i, it] of body.items.entries()) {
      const item = soItems.find((s) => s.id === it.sales_order_item_id);
      if (!item) throw badRequest('Item não pertence ao pedido.', [{ field: `items.${i}.sales_order_item_id`, message: 'Item inválido.' }]);
      const deliverable = qty(item.confirmed_qty - item.delivered_qty - Number(pending.find((p) => p.sales_order_item_id === item.id)?.q ?? 0));
      if (it.quantity > deliverable + 1e-9) {
        throw badRequest(`Item ${item.item_no}: só ${deliverable} confirmado(s) e ainda não entregue(s).`, [{ field: `items.${i}.quantity`, message: `Máximo ${deliverable}.` }]);
      }
      rows.push({ sales_order_item_id: item.id, material_id: item.material_id, storage_location_id: item.storage_location_id, quantity: qty(it.quantity) });
    }
    const number = await nextNumber(trx, 'DELIVERY');
    const [id] = await trx('deliveries').insert({ number, sales_order_id: so.id, plant_id: so.plant_id, ship_to: so.ship_to, created_by: req.user.id });
    await trx('delivery_items').insert(rows.map((r) => ({ ...r, delivery_id: id })));
    await refreshOrderStatus(trx, so.id);
    await audit(req, { action: 'CREATE', entity: 'deliveries', entityId: id, result: 'SUCCESS', details: { numero: number, pedido: so.number, itens: body.items } }, trx);
    return deliveryDetail(req, id, trx);
  });
  res.status(201).json({ data });
});

deliveriesRouter.post('/deliveries/:id/pick', requirePermission('SD.DELIVERY.CREATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Entrega');
  const body = z.object({ items: z.array(z.object({ delivery_item_id: zId, picked_qty: z.coerce.number().min(0, 'Não pode ser negativa.') }).strict()).min(1) }).strict().parse(req.body);
  const data = await withTransaction(async (trx) => {
    const d = await findScoped(req, 'deliveries', id, { trx, lock: true, what: 'Entrega' });
    if (d.status === 'POSTED') throw invalidStatus(d.number, d.status, 'separar (a saída já foi lançada)');
    const items = await trx('delivery_items').where({ delivery_id: id });
    for (const [i, it] of body.items.entries()) {
      const item = items.find((x) => x.id === it.delivery_item_id);
      if (!item) throw badRequest('Item não pertence à entrega.', [{ field: `items.${i}.delivery_item_id`, message: 'Item inválido.' }]);
      if (it.picked_qty > item.quantity + 1e-9) throw badRequest(`Separado (${it.picked_qty}) maior que o da entrega (${item.quantity}).`, [{ field: `items.${i}.picked_qty`, message: `Máximo ${item.quantity}.` }]);
      await trx('delivery_items').where({ id: item.id }).update({ picked_qty: qty(it.picked_qty) });
    }
    // Itens não informados: separados integralmente.
    await trx('delivery_items').where({ delivery_id: id }).whereNull('picked_qty').update({ picked_qty: trx.ref('quantity') });
    await trx('deliveries').where({ id }).update({ status: 'PICKED', picked_by: req.user.id, picked_at: new Date() });
    await audit(req, { action: 'PICK', entity: 'deliveries', entityId: id, result: 'SUCCESS', details: { numero: d.number, itens: body.items } }, trx);
    return deliveryDetail(req, id, trx);
  });
  res.json({ data });
});

deliveriesRouter.post('/deliveries/:id/post-goods-issue', requirePermission('SD.DELIVERY.CREATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Entrega');
  const data = await withTransaction(async (trx) => {
    const d = await findScoped(req, 'deliveries', id, { trx, lock: true, what: 'Entrega' });
    if (d.status !== 'PICKED') throw invalidStatus(d.number, d.status, 'lançar a saída (faça a separação antes)');
    const so = await trx('sales_orders').where({ id: d.sales_order_id }).forUpdate().first();
    const items = (await trx('delivery_items').where({ delivery_id: id })).filter((i) => i.picked_qty > 0);
    if (!items.length) throw badRequest('Nada foi separado: não há o que expedir. Exclua a entrega ou refaça a separação.');
    const doc = await postMaterialDocument(trx, {
      lines: items.map((i) => ({
        movementType: 601, materialId: i.material_id, plantId: d.plant_id, storageLocationId: i.storage_location_id, quantity: i.picked_qty,
        referenceType: 'DELIVERY', referenceId: id, referenceItemId: i.id,
      })),
      reason: `Saída de mercadoria da entrega ${d.number} (pedido ${so.number})`,
      userId: req.user.id,
    });
    for (const i of items) {
      await trx('sales_order_items').where({ id: i.sales_order_item_id }).update({ delivered_qty: trx.raw('delivered_qty + ?', [i.picked_qty]) });
    }
    await trx('deliveries').where({ id }).update({ status: 'POSTED', posted_by: req.user.id, posted_at: new Date(), material_doc_number: doc.docNumber });
    const status = await refreshOrderStatus(trx, so.id);
    await audit(req, { action: 'GOODS_ISSUE', entity: 'deliveries', entityId: id, result: 'SUCCESS', details: { numero: d.number, pedido: so.number, documento_material: doc.docNumber, status_pedido: status } }, trx);
    return deliveryDetail(req, id, trx);
  });
  res.json({ data });
});

deliveriesRouter.delete('/deliveries/:id', requirePermission('SD.DELIVERY.CREATE'), async (req, res) => {
  const id = parseId(req.params.id, 'Entrega');
  await withTransaction(async (trx) => {
    const d = await findScoped(req, 'deliveries', id, { trx, lock: true, what: 'Entrega' });
    if (d.status === 'POSTED') throw invalidStatus(d.number, d.status, 'excluir (a saída de mercadoria já foi lançada)');
    await trx('deliveries').where({ id }).del();
    await refreshOrderStatus(trx, d.sales_order_id);
    await audit(req, { action: 'DELETE', entity: 'deliveries', entityId: id, result: 'SUCCESS', details: { numero: d.number } }, trx);
  });
  res.status(204).end();
});
