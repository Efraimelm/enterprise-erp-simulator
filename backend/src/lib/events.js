// Eventos de integração (padrão outbox). O evento é gravado na MESMA transação do documento:
// se a operação for desfeita, o evento some junto; se for confirmada, o evento existe com certeza.
// O despachante (lib/webhooks.js) entrega depois, com novas tentativas.
import crypto from 'node:crypto';
import { qty } from './numbers.js';

export const EVENT_TYPES = {
  'stock.below_reorder_point': 'Estoque disponível no ponto de reposição ou abaixo',
  'purchase_requisition.created': 'Requisição de compra criada',
  'purchase_order.approved': 'Pedido de compra aprovado',
  'goods_receipt.posted': 'Recebimento de mercadoria lançado',
  'sales_order.created': 'Pedido de venda criado',
  'sales_order.confirmed': 'Pedido de venda confirmado (estoque reservado)',
  'delivery.posted': 'Saída de mercadoria da entrega lançada',
  'billing.created': 'Fatura emitida',
  'integration.ping': 'Teste de conexão (enviado pela tela de integrações)',
};

export async function emitEvent(trx, type, data, { plantId = null, dedupeKey = null } = {}) {
  if (!EVENT_TYPES[type]) throw new Error(`Tipo de evento desconhecido: ${type}`);
  const eventId = crypto.randomUUID();
  await trx('integration_events').insert({
    event_id: eventId, event_type: type, plant_id: plantId, dedupe_key: dedupeKey, payload: JSON.stringify(data),
  });
  return eventId;
}

/**
 * Depois de uma saída ou reserva: se o disponível do material no centro ficou no ponto de
 * reposição ou abaixo, emite `stock.below_reorder_point` (no máximo um a cada 12 h por material × centro).
 */
export async function checkReorderPoint(trx, materialId, plantId) {
  const pd = await trx('material_plant_data as d').join('materials as m', 'm.id', 'd.material_id').join('plants as p', 'p.id', 'd.plant_id')
    .where({ 'd.material_id': materialId, 'd.plant_id': plantId })
    .first('d.reorder_point', 'd.max_stock', 'd.min_stock', 'm.code', 'm.description', 'm.base_unit', 'p.code as plant_code');
  if (!pd || !(pd.reorder_point > 0)) return;
  const [{ available }] = await trx('stock_balances').where({ material_id: materialId, plant_id: plantId })
    .select(trx.raw('COALESCE(SUM(physical_qty - reserved_qty), 0) as available'));
  if (Number(available) > pd.reorder_point) return;
  const dedupeKey = `below:${materialId}:${plantId}`;
  const recent = await trx('integration_events').where({ dedupe_key: dedupeKey })
    .where('occurred_at', '>', new Date(Date.now() - 12 * 3600_000)).first('id');
  if (recent) return;
  await emitEvent(trx, 'stock.below_reorder_point', {
    material: { id: materialId, code: pd.code, description: pd.description, unit: pd.base_unit },
    plant: { id: plantId, code: pd.plant_code },
    available_qty: qty(available), reorder_point: pd.reorder_point, min_stock: pd.min_stock, max_stock: pd.max_stock,
  }, { plantId, dedupeKey });
}
