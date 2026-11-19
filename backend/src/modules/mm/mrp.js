// MRP simplificado (ver docs/mm-design.md, regra A7).
//   POST /api/mm/mrp/run       { plant_id? }                              MM.MRP.RUN
//   POST /api/mm/mrp/convert   { items: [{ material_id, plant_id, quantity }], justification? }   MM.MRP.RUN + MM.PURCHASE_REQ.CREATE
//
// cobertura = disponível + pedidos em aberto (não cancelados, ainda não recebidos) + requisições abertas
// se cobertura <= ponto de reposição → sugere (estoque máximo − cobertura); sem máximo: (2 × ponto − cobertura)
// O MRP só SUGERE. Quem decide converter é uma pessoa, e a requisição criada ainda passa pela aprovação.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { forbidden } from '../../lib/errors.js';
import { money, qty } from '../../lib/numbers.js';
import { withTransaction } from '../../lib/tx.js';
import { requirePermission } from '../../middleware/auth.js';
import { assertPlant, scopePlants, zId, zQty } from './common.js';
import { createRequisition } from './purchasing.js';

const OPEN_PO = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];
const OPEN_PR = ['PENDING_APPROVAL', 'APPROVED'];

/** Calcula as sugestões. Exportado para uso futuro pela API de integração (n8n, Etapa 6). */
export async function computeMrp(req, plantId) {
  const planning = await scopePlants(db('material_plant_data as d'), req, 'd.plant_id')
    .join('materials as m', 'm.id', 'd.material_id')
    .join('plants as p', 'p.id', 'd.plant_id')
    .where('m.status', 'ACTIVE')
    .where('d.reorder_point', '>', 0)
    .where((qb) => { if (plantId) qb.where('d.plant_id', plantId); })
    .select('d.material_id', 'd.plant_id', 'd.reorder_point', 'd.min_stock', 'd.max_stock', 'm.code as material_code', 'm.description', 'm.base_unit', 'm.reference_price', 'p.code as plant_code');
  if (!planning.length) return [];

  const plantIds = [...new Set(planning.map((p) => p.plant_id))];
  const key = (r) => `${r.material_id}:${r.plant_id}`;
  const toMap = (rows, field) => new Map(rows.map((r) => [key(r), Number(r[field])]));

  const available = toMap(await db('stock_balances').whereIn('plant_id', plantIds)
    .groupBy('material_id', 'plant_id').select('material_id', 'plant_id', db.raw('SUM(physical_qty - reserved_qty) as q')), 'q');
  const openPo = toMap(await db('purchase_order_items as i').join('purchase_orders as o', 'o.id', 'i.purchase_order_id')
    .whereIn('o.plant_id', plantIds).whereIn('o.status', OPEN_PO)
    .groupBy('i.material_id', 'o.plant_id').select('i.material_id', 'o.plant_id', db.raw('SUM(GREATEST(i.quantity - i.received_qty, 0)) as q')), 'q');
  const openPr = toMap(await db('purchase_requisition_items as i').join('purchase_requisitions as r', 'r.id', 'i.requisition_id')
    .whereIn('r.plant_id', plantIds).whereIn('r.status', OPEN_PR)
    .groupBy('i.material_id', 'r.plant_id').select('i.material_id', 'r.plant_id', db.raw('SUM(i.quantity) as q')), 'q');
  const bestPrice = new Map((await db('supplier_materials as sm').join('suppliers as s', 's.id', 'sm.supplier_id').where('s.status', 'ACTIVE')
    .whereIn('sm.material_id', planning.map((p) => p.material_id))
    .select('sm.material_id', 's.id as supplier_id', 's.code as supplier_code', 's.name as supplier_name', 'sm.net_price')
    .orderBy('sm.net_price')).reverse().map((r) => [r.material_id, r]));

  const suggestions = [];
  for (const p of planning) {
    const k = key(p);
    const avail = qty(available.get(k) ?? 0);
    const po = qty(openPo.get(k) ?? 0);
    const pr = qty(openPr.get(k) ?? 0);
    const coverage = qty(avail + po + pr);
    if (coverage > p.reorder_point) continue;
    const target = p.max_stock > 0 ? p.max_stock : 2 * p.reorder_point;
    const suggested = qty(Math.ceil(target - coverage)); // arredonda para cima: unidades inteiras
    if (suggested <= 0) continue;
    const supplier = bestPrice.get(p.material_id);
    const price = supplier?.net_price ?? p.reference_price;
    suggestions.push({
      material_id: p.material_id, material_code: p.material_code, description: p.description, base_unit: p.base_unit,
      plant_id: p.plant_id, plant_code: p.plant_code,
      available_qty: avail, open_po_qty: po, open_pr_qty: pr, coverage_qty: coverage,
      reorder_point: p.reorder_point, min_stock: p.min_stock, max_stock: p.max_stock,
      suggested_qty: suggested, below_min: avail < p.min_stock,
      supplier: supplier ? { id: supplier.supplier_id, code: supplier.supplier_code, name: supplier.supplier_name, net_price: supplier.net_price } : null,
      estimated_value: money(suggested * price),
    });
  }
  return suggestions.sort((a, b) => Number(b.below_min) - Number(a.below_min) || a.plant_code.localeCompare(b.plant_code) || a.material_code.localeCompare(b.material_code));
}

export const mrpRouter = Router();

mrpRouter.post('/mrp/run', requirePermission('MM.MRP.RUN'), async (req, res) => {
  const { plant_id: plantId } = z.object({ plant_id: z.preprocess((v) => (v === '' ? undefined : v), zId.optional()) }).strict().parse(req.body ?? {});
  if (plantId) await assertPlant(req, plantId);
  const suggestions = await computeMrp(req, plantId);
  await audit(req, { action: 'MRP_RUN', entity: 'mrp', entityId: plantId ?? 'escopo', result: 'SUCCESS', details: { sugestoes: suggestions.length } });
  res.json({
    data: suggestions,
    meta: {
      run_at: new Date().toISOString(),
      total_estimated_value: money(suggestions.reduce((s, x) => s + x.estimated_value, 0)),
      rule: 'cobertura = disponível + pedidos em aberto + requisições abertas; sugere quando cobertura ≤ ponto de reposição, até o estoque máximo',
    },
  });
});

mrpRouter.post('/mrp/convert', requirePermission('MM.MRP.RUN'), async (req, res) => {
  if (!req.user.permissions.has('MM.PURCHASE_REQ.CREATE')) throw forbidden('Converter sugestões exige também a permissão MM.PURCHASE_REQ.CREATE.');
  const body = z.object({
    justification: z.string().trim().max(255).optional(),
    items: z.array(z.object({ material_id: zId, plant_id: zId, quantity: zQty }).strict()).min(1, 'Selecione pelo menos uma sugestão.').max(200),
  }).strict().parse(req.body);
  for (const plantId of new Set(body.items.map((i) => i.plant_id))) await assertPlant(req, plantId);

  const needDate = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  const created = await withTransaction(async (trx) => {
    const out = [];
    const byPlant = Map.groupBy(body.items, (i) => i.plant_id);
    for (const [plantId, items] of byPlant) {
      const pr = await createRequisition(trx, {
        plantId, requesterId: req.user.id, source: 'MRP',
        justification: body.justification || 'Sugestão do MRP simplificado (ponto de reposição)',
        items: items.map((i) => ({ material_id: i.material_id, quantity: i.quantity, need_date: needDate })),
      });
      await audit(req, { action: 'CREATE', entity: 'purchase_requisitions', entityId: pr.id, result: 'SUCCESS', details: { numero: pr.number, origem: 'MRP', itens: items.length } }, trx);
      out.push(pr);
    }
    return out;
  });
  res.status(201).json({ data: created });
});
