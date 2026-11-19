// Estoque.
//   GET  /api/mm/stock                         saldos (material, plant_id, storage_location_id, below_reorder)   MM.STOCK.READ
//   GET  /api/mm/stock/movements               movimentos (material_id, plant_id, movement_type, doc_number)     MM.STOCK.READ
//   GET  /api/mm/material-documents/:number    um documento de material com suas linhas                          MM.STOCK.READ
//   POST /api/mm/stock/movements               movimento manual 561/201/311 com justificativa                    MM.STOCK.ADJUST
//   GET  /api/mm/inventory                     documentos de inventário                                          MM.STOCK.READ
//   GET  /api/mm/inventory/:id                 um inventário com os itens                                        MM.STOCK.READ
//   POST /api/mm/inventory                     contagem + lançamento das diferenças (701/702)                    MM.STOCK.ADJUST
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { nextNumber } from '../../lib/numbering.js';
import { qty } from '../../lib/numbers.js';
import { withTransaction } from '../../lib/tx.js';
import { requirePermission } from '../../middleware/auth.js';
import { assertMaterialForPlant, assertPlant, assertSlocInPlant, findScoped, like, pageSchema, parseId, scopePlants, zId, zQty } from './common.js';
import { MOVEMENT_TYPES, postMaterialDocument } from './stock-service.js';

const zReason = z.string().trim().min(5, 'Justifique com pelo menos 5 caracteres.').max(255);

const movementSchema = z.discriminatedUnion('movement_type', [
  z.object({ movement_type: z.enum(['561', '201']), material_id: zId, plant_id: zId, storage_location_id: zId, quantity: zQty, reason: zReason }).strict(),
  z.object({ movement_type: z.literal('311'), material_id: zId, plant_id: zId, storage_location_id: zId, to_storage_location_id: zId, quantity: zQty, reason: zReason }).strict(),
], { errorMap: () => ({ message: 'Tipo de movimento manual inválido. Use 561, 201 ou 311.' }) });

const inventorySchema = z.object({
  plant_id: zId,
  storage_location_id: zId,
  reason: zReason,
  items: z.array(z.object({ material_id: zId, counted_qty: z.coerce.number().min(0, 'Contagem não pode ser negativa.') }).strict()).min(1, 'Conte pelo menos um material.').max(200),
}).strict();

export const stockRouter = Router();

stockRouter.get('/stock', requirePermission('MM.STOCK.READ'), async (req, res) => {
  const f = z.object({
    ...pageSchema,
    q: z.string().trim().max(80).optional(),
    plant_id: zId.optional(),
    storage_location_id: zId.optional(),
    material_id: zId.optional(),
    below_reorder: z.enum(['true', 'false']).optional(),
  }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);

  // Saldos por depósito + dados de planejamento do centro (ponto de reposição, mínimo).
  const base = scopePlants(db('stock_balances as b'), req, 'b.plant_id')
    .join('materials as m', 'm.id', 'b.material_id')
    .join('plants as p', 'p.id', 'b.plant_id')
    .join('storage_locations as s', 's.id', 'b.storage_location_id')
    .leftJoin('material_plant_data as d', (j) => j.on('d.material_id', 'b.material_id').andOn('d.plant_id', 'b.plant_id'))
    .where((qb) => {
      if (f.q) qb.where((w) => w.where('m.code', 'like', like(f.q)).orWhere('m.description', 'like', like(f.q)));
      if (f.plant_id) qb.where('b.plant_id', f.plant_id);
      if (f.storage_location_id) qb.where('b.storage_location_id', f.storage_location_id);
      if (f.material_id) qb.where('b.material_id', f.material_id);
      if (f.below_reorder === 'true') {
        // Disponível somado de todos os depósitos do centro ≤ ponto de reposição.
        qb.whereRaw(
          `d.reorder_point > 0 AND (SELECT COALESCE(SUM(b2.physical_qty - b2.reserved_qty), 0) FROM stock_balances b2
            WHERE b2.material_id = b.material_id AND b2.plant_id = b.plant_id) <= d.reorder_point`,
        );
      }
    });
  const [{ total }] = await base.clone().count({ total: '*' });
  const rows = await base.clone()
    .select('b.id', 'b.material_id', 'm.code as material_code', 'm.description', 'm.base_unit', 'm.status as material_status',
      'b.plant_id', 'p.code as plant_code', 'b.storage_location_id', 's.code as sloc_code', 's.name as sloc_name',
      'b.physical_qty', 'b.reserved_qty', 'd.min_stock', 'd.reorder_point', 'd.max_stock', 'b.updated_at')
    .orderBy(['m.code', 'p.code', 's.code'])
    .limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({
    data: rows.map((r) => ({ ...r, available_qty: qty(r.physical_qty - r.reserved_qty) })),
    page: f.page, pageSize: f.pageSize, total: Number(total),
  });
});

stockRouter.get('/stock/movements', requirePermission('MM.STOCK.READ'), async (req, res) => {
  const f = z.object({
    ...pageSchema,
    material_id: zId.optional(),
    plant_id: zId.optional(),
    movement_type: z.string().regex(/^\d{3}$/).optional(),
    doc_number: z.string().regex(/^\d{1,10}$/).optional(),
    reference_type: z.string().max(30).optional(),
    reference_id: zId.optional(),
  }).parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);
  const base = scopePlants(db('stock_movements as mv'), req, 'mv.plant_id').where((qb) => {
    for (const k of ['material_id', 'plant_id', 'movement_type', 'doc_number', 'reference_type', 'reference_id']) if (f[k]) qb.where(`mv.${k}`, f[k]);
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const rows = await base.clone()
    .join('materials as m', 'm.id', 'mv.material_id')
    .join('plants as p', 'p.id', 'mv.plant_id')
    .join('storage_locations as s', 's.id', 'mv.storage_location_id')
    .join('users as u', 'u.id', 'mv.posted_by')
    .select('mv.*', 'm.code as material_code', 'm.description', 'm.base_unit', 'p.code as plant_code', 's.code as sloc_code', 'u.username as posted_by_username')
    .orderBy('mv.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({
    data: rows.map((r) => ({ ...r, movement_label: MOVEMENT_TYPES[r.movement_type]?.label })),
    page: f.page, pageSize: f.pageSize, total: Number(total),
  });
});

stockRouter.get('/material-documents/:number', requirePermission('MM.STOCK.READ'), async (req, res) => {
  const number = String(req.params.number);
  const lines = await db('stock_movements as mv')
    .join('materials as m', 'm.id', 'mv.material_id')
    .join('storage_locations as s', 's.id', 'mv.storage_location_id')
    .join('plants as p', 'p.id', 'mv.plant_id')
    .join('users as u', 'u.id', 'mv.posted_by')
    .where('mv.doc_number', number)
    .select('mv.*', 'm.code as material_code', 'm.description', 'm.base_unit', 's.code as sloc_code', 'p.code as plant_code', 'u.username as posted_by_username')
    .orderBy('mv.line_no');
  if (!lines.length) throw notFound('Documento de material não encontrado.');
  for (const plantId of new Set(lines.map((l) => l.plant_id))) await assertPlant(req, plantId);
  res.json({ data: { doc_number: number, posted_at: lines[0].posted_at, posted_by: lines[0].posted_by_username, reason: lines[0].reason, lines: lines.map((l) => ({ ...l, movement_label: MOVEMENT_TYPES[l.movement_type]?.label })) } });
});

stockRouter.post('/stock/movements', requirePermission('MM.STOCK.ADJUST'), async (req, res) => {
  const body = movementSchema.parse(req.body);
  await assertPlant(req, body.plant_id);
  const result = await withTransaction(async (trx) => {
    await assertMaterialForPlant(trx, body.material_id, body.plant_id);
    await assertSlocInPlant(trx, body.storage_location_id, body.plant_id);
    if (body.movement_type === '311') {
      await assertSlocInPlant(trx, body.to_storage_location_id, body.plant_id, 'to_storage_location_id');
      if (body.to_storage_location_id === body.storage_location_id) {
        throw badRequest('Origem e destino iguais.', [{ field: 'to_storage_location_id', message: 'Escolha outro depósito de destino.' }]);
      }
    }
    const doc = await postMaterialDocument(trx, {
      lines: [{
        movementType: Number(body.movement_type), materialId: body.material_id, plantId: body.plant_id,
        storageLocationId: body.storage_location_id, toStorageLocationId: body.to_storage_location_id, quantity: body.quantity,
      }],
      reason: body.reason,
      userId: req.user.id,
    });
    await audit(req, { action: 'STOCK_MOVEMENT', entity: 'stock_movements', entityId: doc.docNumber, result: 'SUCCESS', details: body }, trx);
    return doc;
  });
  res.status(201).json({ data: { doc_number: result.docNumber, lines: result.movements } });
});

stockRouter.get('/inventory', requirePermission('MM.STOCK.READ'), async (req, res) => {
  const f = z.object({ ...pageSchema, plant_id: zId.optional() }).parse(req.query);
  const base = scopePlants(db('inventory_documents as i'), req, 'i.plant_id').where((qb) => { if (f.plant_id) qb.where('i.plant_id', f.plant_id); });
  const [{ total }] = await base.clone().count({ total: '*' });
  const data = await base.clone()
    .join('plants as p', 'p.id', 'i.plant_id').join('storage_locations as s', 's.id', 'i.storage_location_id').join('users as u', 'u.id', 'i.posted_by')
    .select('i.*', 'p.code as plant_code', 's.code as sloc_code', 'u.username as posted_by_username',
      db.raw('(SELECT COUNT(*) FROM inventory_items it WHERE it.inventory_document_id = i.id) as item_count'),
      db.raw('(SELECT COUNT(*) FROM inventory_items it WHERE it.inventory_document_id = i.id AND it.difference <> 0) as difference_count'))
    .orderBy('i.id', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  res.json({ data, page: f.page, pageSize: f.pageSize, total: Number(total) });
});

stockRouter.get('/inventory/:id', requirePermission('MM.STOCK.READ'), async (req, res) => {
  const doc = await findScoped(req, 'inventory_documents', parseId(req.params.id, 'Inventário'), { what: 'Inventário' });
  const items = await db('inventory_items as it').join('materials as m', 'm.id', 'it.material_id')
    .where('it.inventory_document_id', doc.id).select('it.*', 'm.code as material_code', 'm.description', 'm.base_unit').orderBy('m.code');
  res.json({ data: { ...doc, items } });
});

stockRouter.post('/inventory', requirePermission('MM.STOCK.ADJUST'), async (req, res) => {
  const body = inventorySchema.parse(req.body);
  await assertPlant(req, body.plant_id);
  const ids = body.items.map((i) => i.material_id);
  if (new Set(ids).size !== ids.length) throw badRequest('Material repetido na contagem.', [{ field: 'items', message: 'Cada material aparece uma vez.' }]);

  const result = await withTransaction(async (trx) => {
    await assertSlocInPlant(trx, body.storage_location_id, body.plant_id);
    const lines = [];
    const items = [];
    for (const it of body.items) {
      await assertMaterialForPlant(trx, it.material_id, body.plant_id);
      const bal = await trx('stock_balances').where({ material_id: it.material_id, storage_location_id: body.storage_location_id }).forUpdate().first();
      const book = qty(bal?.physical_qty ?? 0);
      const counted = qty(it.counted_qty);
      const difference = qty(counted - book);
      items.push({ material_id: it.material_id, book_qty: book, counted_qty: counted, difference });
      if (difference !== 0) {
        lines.push({
          movementType: difference > 0 ? 701 : 702, materialId: it.material_id, plantId: body.plant_id,
          storageLocationId: body.storage_location_id, quantity: Math.abs(difference), referenceType: 'INVENTORY',
        });
      }
    }
    const docNumber = await nextNumber(trx, 'INVENTORY_DOC');
    const [inventoryId] = await trx('inventory_documents').insert({
      doc_number: docNumber, plant_id: body.plant_id, storage_location_id: body.storage_location_id, reason: body.reason, posted_by: req.user.id,
    });
    await trx('inventory_items').insert(items.map((i) => ({ ...i, inventory_document_id: inventoryId })));
    let materialDoc = null;
    if (lines.length) {
      materialDoc = (await postMaterialDocument(trx, { lines: lines.map((l) => ({ ...l, referenceId: inventoryId })), reason: `Inventário ${docNumber}: ${body.reason}`, userId: req.user.id })).docNumber;
      await trx('inventory_documents').where({ id: inventoryId }).update({ material_doc_number: materialDoc });
    }
    await audit(req, { action: 'INVENTORY', entity: 'inventory_documents', entityId: inventoryId, result: 'SUCCESS', details: { documento: docNumber, documento_material: materialDoc, diferencas: items.filter((i) => i.difference !== 0) } }, trx);
    return { id: inventoryId, doc_number: docNumber, material_doc_number: materialDoc, items };
  });
  res.status(201).json({ data: result });
});
