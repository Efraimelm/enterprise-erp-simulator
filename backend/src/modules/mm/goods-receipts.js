// Recebimento de mercadorias com referência a pedido de compra (movimento 101).
//   GET  /api/mm/goods-receipts          MM.STOCK.READ ou MM.PURCHASE_ORDER.READ   (plant_id, purchase_order_id)
//   GET  /api/mm/goods-receipts/:id      idem
//   POST /api/mm/goods-receipts          MM.GOODS_RECEIPT.POST
//        { purchase_order_id, notes?, items: [{ purchase_order_item_id, quantity, storage_location_id? }] }
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, forbidden, HttpError } from '../../lib/errors.js';
import { qty } from '../../lib/numbers.js';
import { withTransaction } from '../../lib/tx.js';
import { requirePermission } from '../../middleware/auth.js';
import { assertPlant, assertSlocInPlant, findScoped, pageSchema, parseId, scopePlants, zId, zOptText, zQty } from './common.js';
import { postMaterialDocument } from './stock-service.js';

const RECEIVABLE = ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];

const grSchema = z.object({
  purchase_order_id: zId,
  notes: zOptText(255),
  items: z.array(z.object({
    purchase_order_item_id: zId,
    quantity: zQty,
    storage_location_id: z.preprocess((v) => (v === '' ? null : v), zId.nullable().optional()),
  }).strict()).min(1, 'Informe pelo menos um item recebido.').max(100),
}).strict();

function canRead(req) {
  if (req.user.permissions.has('MM.STOCK.READ') || req.user.permissions.has('MM.PURCHASE_ORDER.READ')) return;
  throw forbidden('Você não tem a permissão MM.STOCK.READ nem MM.PURCHASE_ORDER.READ.');
}

export const goodsReceiptsRouter = Router();

goodsReceiptsRouter.get('/goods-receipts', requirePermission('MM.MATERIAL.READ'), async (req, res) => {
  canRead(req);
  const f = z.object({ ...pageSchema, plant_id: zId.optional(), purchase_order_id: zId.optional() }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);
  const base = scopePlants(db('goods_receipts as g'), req, 'g.plant_id').where((qb) => {
    if (f.plant_id) qb.where('g.plant_id', f.plant_id);
    if (f.purchase_order_id) qb.where('g.purchase_order_id', f.purchase_order_id);
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone()
    .join('purchase_orders as o', 'o.id', 'g.purchase_order_id').join('suppliers as s', 's.id', 'o.supplier_id')
    .join('plants as p', 'p.id', 'g.plant_id').join('users as u', 'u.id', 'g.posted_by')
    .select('g.*', 'o.number as purchase_order_number', 's.name as supplier_name', 'p.code as plant_code', 'u.username as posted_by_username',
      db.raw("(SELECT COUNT(*) FROM stock_movements mv WHERE mv.doc_number = g.doc_number) as line_count"))
    .orderBy('g.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});

goodsReceiptsRouter.get('/goods-receipts/:id', requirePermission('MM.MATERIAL.READ'), async (req, res) => {
  canRead(req);
  const gr = await findScoped(req, 'goods_receipts', parseId(req.params.id, 'Recebimento'), { what: 'Recebimento' });
  const lines = await db('stock_movements as mv').join('materials as m', 'm.id', 'mv.material_id').join('storage_locations as s', 's.id', 'mv.storage_location_id')
    .leftJoin('purchase_order_items as i', 'i.id', 'mv.reference_item_id')
    .where('mv.doc_number', gr.doc_number)
    .select('mv.line_no', 'mv.quantity', 'm.code as material_code', 'm.description', 'm.base_unit', 's.code as sloc_code', 'i.item_no as po_item_no')
    .orderBy('mv.line_no');
  const po = await db('purchase_orders').where({ id: gr.purchase_order_id }).first('number', 'status');
  res.json({ data: { ...gr, purchase_order_number: po.number, purchase_order_status: po.status, lines } });
});

goodsReceiptsRouter.post('/goods-receipts', requirePermission('MM.GOODS_RECEIPT.POST'), async (req, res) => {
  const body = grSchema.parse(req.body);
  const ids = body.items.map((i) => i.purchase_order_item_id);
  if (new Set(ids).size !== ids.length) throw badRequest('Item do pedido repetido.', [{ field: 'items', message: 'Cada item do pedido aparece uma vez.' }]);

  const data = await withTransaction(async (trx) => {
    const po = await findScoped(req, 'purchase_orders', body.purchase_order_id, { trx, lock: true, what: 'Pedido de compra' });
    if (!RECEIVABLE.includes(po.status)) {
      throw new HttpError(409, 'INVALID_STATUS', `O pedido ${po.number} está com status ${po.status}: só é possível receber pedidos aprovados ou enviados.`);
    }
    const supplier = await trx('suppliers').where({ id: po.supplier_id }).first('overdelivery_tolerance_pct');
    const canOverdeliver = req.user.permissions.has('MM.GOODS_RECEIPT.OVERDELIVERY');
    const poItems = await trx('purchase_order_items').where({ purchase_order_id: po.id }).forUpdate();

    const lines = [];
    for (const [i, it] of body.items.entries()) {
      const item = poItems.find((p) => p.id === it.purchase_order_item_id);
      if (!item) throw badRequest('Item não pertence ao pedido.', [{ field: `items.${i}.purchase_order_item_id`, message: 'Item inválido.' }]);
      const open = qty(item.quantity - item.received_qty);
      const tolerance = canOverdeliver ? qty((item.quantity * Number(supplier.overdelivery_tolerance_pct)) / 100) : 0;
      if (it.quantity > open + tolerance) {
        const extra = canOverdeliver
          ? ` A tolerância do fornecedor permite até ${qty(open + tolerance)}.`
          : ' Para receber acima do pedido é preciso a permissão MM.GOODS_RECEIPT.OVERDELIVERY.';
        throw badRequest(`Item ${item.item_no}: quantidade ${it.quantity} acima da pendente (${open}).${extra}`, [{ field: `items.${i}.quantity`, message: `Pendente: ${open}.` }]);
      }
      const slocId = it.storage_location_id ?? item.storage_location_id;
      await assertSlocInPlant(trx, slocId, po.plant_id, `items.${i}.storage_location_id`);
      lines.push({
        movementType: 101, materialId: item.material_id, plantId: po.plant_id, storageLocationId: slocId, quantity: it.quantity,
        referenceType: 'PURCHASE_ORDER', referenceId: po.id, referenceItemId: item.id,
      });
      item.received_qty = qty(item.received_qty + it.quantity);
      await trx('purchase_order_items').where({ id: item.id }).update({ received_qty: item.received_qty });
    }

    const doc = await postMaterialDocument(trx, { lines, reason: body.notes ?? `Recebimento do pedido ${po.number}`, userId: req.user.id });
    const [grId] = await trx('goods_receipts').insert({ doc_number: doc.docNumber, purchase_order_id: po.id, plant_id: po.plant_id, notes: body.notes ?? null, posted_by: req.user.id });

    const complete = poItems.every((p) => p.received_qty >= p.quantity);
    const status = complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await trx('purchase_orders').where({ id: po.id }).update({ status });
    await audit(req, {
      action: 'GOODS_RECEIPT', entity: 'purchase_orders', entityId: po.id, result: 'SUCCESS',
      details: { pedido: po.number, documento_material: doc.docNumber, de: po.status, para: status, itens: body.items },
    }, trx);
    return { id: grId, doc_number: doc.docNumber, purchase_order_id: po.id, purchase_order_number: po.number, purchase_order_status: status, lines: doc.movements };
  });
  res.status(201).json({ data });
});
