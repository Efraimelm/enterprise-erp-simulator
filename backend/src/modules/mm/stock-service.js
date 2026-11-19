// Serviço de estoque: o ÚNICO lugar do sistema que altera stock_balances.
// Cada chamada gera um documento de material (49xxxxxxxx) com uma linha em stock_movements por
// alteração de saldo, tudo na transação recebida.
import { HttpError } from '../../lib/errors.js';
import { nextNumber } from '../../lib/numbering.js';
import { qty } from '../../lib/numbers.js';

export const MOVEMENT_TYPES = {
  101: { label: 'Entrada por pedido de compra', sign: +1 },
  561: { label: 'Entrada inicial / ajuste de entrada', sign: +1, manual: true },
  201: { label: 'Saída para consumo', sign: -1, manual: true },
  311: { label: 'Transferência entre depósitos', transfer: true, manual: true },
  701: { label: 'Sobra de inventário', sign: +1 },
  702: { label: 'Falta de inventário', sign: -1 },
  601: { label: 'Saída de mercadoria para cliente (entrega)', sign: -1, consumesReservation: true },
};

/** Garante que a linha de saldo existe e a trava (FOR UPDATE) até o fim da transação. */
async function lockBalance(trx, materialId, plantId, slocId) {
  await trx.raw(
    'INSERT INTO stock_balances (material_id, plant_id, storage_location_id, physical_qty, reserved_qty) VALUES (?, ?, ?, 0, 0) ON DUPLICATE KEY UPDATE id = id',
    [materialId, plantId, slocId],
  );
  return trx('stock_balances').where({ material_id: materialId, storage_location_id: slocId }).forUpdate().first();
}

/**
 * Lança um documento de material.
 * @param trx     transação Knex
 * @param lines   [{ movementType, materialId, plantId, storageLocationId, quantity (>0), toStorageLocationId?, referenceType?, referenceId?, referenceItemId? }]
 * @param reason  justificativa (obrigatória para movimentos manuais)
 * @param userId  responsável
 * @returns { docNumber, movements }
 */
export async function postMaterialDocument(trx, { lines, reason = null, userId }) {
  // Expande transferências em saída + entrada.
  const postings = [];
  for (const l of lines) {
    const type = MOVEMENT_TYPES[l.movementType];
    if (!type) throw new Error(`Tipo de movimento desconhecido: ${l.movementType}`);
    const amount = qty(l.quantity);
    if (!(amount > 0)) throw new HttpError(400, 'VALIDATION_ERROR', 'A quantidade deve ser maior que zero.');
    const ref = { referenceType: l.referenceType ?? null, referenceId: l.referenceId ?? null, referenceItemId: l.referenceItemId ?? null };
    if (type.transfer) {
      postings.push({ ...l, ...ref, delta: -amount });
      postings.push({ ...l, ...ref, storageLocationId: l.toStorageLocationId, delta: amount });
    } else {
      postings.push({ ...l, ...ref, delta: type.sign * amount });
    }
  }

  // Trava os saldos sempre na mesma ordem para reduzir deadlocks entre transações concorrentes.
  const order = [...new Set(postings.map((p) => `${p.materialId}:${p.storageLocationId}`))].sort();
  const balances = new Map();
  for (const key of order) {
    const p = postings.find((x) => `${x.materialId}:${x.storageLocationId}` === key);
    balances.set(key, await lockBalance(trx, p.materialId, p.plantId, p.storageLocationId));
  }

  for (const p of postings) {
    const bal = balances.get(`${p.materialId}:${p.storageLocationId}`);
    if (MOVEMENT_TYPES[p.movementType].consumesReservation) {
      // Saída de entrega: baixa a quantidade que já estava reservada para o pedido de venda.
      if (bal.reserved_qty + p.delta < -1e-9 || bal.physical_qty + p.delta < -1e-9) {
        throw new HttpError(409, 'INSUFFICIENT_RESERVATION', `Reserva insuficiente para a saída: reservado ${bal.reserved_qty}, saída ${-p.delta}.`);
      }
      bal.physical_qty = qty(bal.physical_qty + p.delta);
      bal.reserved_qty = qty(bal.reserved_qty + p.delta);
      await trx('stock_balances').where({ id: bal.id }).update({ physical_qty: bal.physical_qty, reserved_qty: bal.reserved_qty });
      continue;
    }
    const available = qty(bal.physical_qty - bal.reserved_qty);
    if (p.delta < 0 && available + p.delta < 0) {
      throw new HttpError(409, 'INSUFFICIENT_STOCK', `Estoque disponível insuficiente: ${available} disponível, ${-p.delta} solicitado.`, {
        material_id: p.materialId, storage_location_id: p.storageLocationId, available, requested: -p.delta,
      });
    }
    bal.physical_qty = qty(bal.physical_qty + p.delta);
    await trx('stock_balances').where({ id: bal.id }).update({ physical_qty: bal.physical_qty });
  }

  const docNumber = await nextNumber(trx, 'MATERIAL_DOC');
  const now = new Date();
  const movements = postings.map((p, i) => ({
    doc_number: docNumber,
    line_no: i + 1,
    movement_type: String(p.movementType),
    material_id: p.materialId,
    plant_id: p.plantId,
    storage_location_id: p.storageLocationId,
    quantity: p.delta,
    reason,
    reference_type: p.referenceType,
    reference_id: p.referenceId,
    reference_item_id: p.referenceItemId,
    posted_by: userId,
    posted_at: now,
  }));
  await trx('stock_movements').insert(movements);
  return { docNumber, movements };
}

/** Disponível (físico − reservado) de um material no depósito, sem travar. Usado pela consulta de ATP. */
export async function availableQty(trx, materialId, slocId) {
  const b = await trx('stock_balances').where({ material_id: materialId, storage_location_id: slocId }).first('physical_qty', 'reserved_qty');
  return b ? qty(b.physical_qty - b.reserved_qty) : 0;
}

/**
 * Reserva estoque para um pedido de venda (ATP simplificado), com trava da linha de saldo.
 * Reserva até `quantity`. Se `allowPartial` for falso e faltar estoque, não reserva nada e lança 409.
 * @returns quantidade efetivamente reservada
 */
export async function reserveStock(trx, { materialId, plantId, storageLocationId, quantity, allowPartial }) {
  const bal = await lockBalance(trx, materialId, plantId, storageLocationId);
  const available = qty(bal.physical_qty - bal.reserved_qty);
  const wanted = qty(quantity);
  if (!allowPartial && available < wanted) {
    throw new HttpError(409, 'INSUFFICIENT_STOCK', `Estoque disponível insuficiente: ${available} disponível, ${wanted} pedido.`, {
      material_id: materialId, storage_location_id: storageLocationId, available, requested: wanted,
    });
  }
  const reserved = qty(Math.max(0, Math.min(available, wanted)));
  if (reserved > 0) await trx('stock_balances').where({ id: bal.id }).update({ reserved_qty: qty(bal.reserved_qty + reserved) });
  return reserved;
}

/** Libera uma reserva (cancelamento de pedido de venda). */
export async function releaseStock(trx, { materialId, plantId, storageLocationId, quantity }) {
  if (!(quantity > 0)) return;
  const bal = await lockBalance(trx, materialId, plantId, storageLocationId);
  await trx('stock_balances').where({ id: bal.id }).update({ reserved_qty: qty(Math.max(0, bal.reserved_qty - quantity)) });
}
