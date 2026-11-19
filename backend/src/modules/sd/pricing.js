// Determinação de preço e desconto (simplificação dos registros de condição do SAP).
//   Preço:    cliente  →  canal  →  geral          (sempre da organização de vendas, dentro da validade)
//   Desconto: cliente+material → cliente → material → canal → geral   (um único desconto, o mais específico)
import { badRequest } from '../../lib/errors.js';
import { money } from '../../lib/numbers.js';

export async function determinePrice(trx, { materialId, salesOrgId, channelId, customerId, date }) {
  const row = await trx('product_prices')
    .where({ material_id: materialId, sales_organization_id: salesOrgId, is_active: true })
    .where('valid_from', '<=', date).where('valid_to', '>=', date)
    .where((q) => q.whereNull('customer_id').orWhere('customer_id', customerId))
    .where((q) => q.whereNull('distribution_channel_id').orWhere('distribution_channel_id', channelId))
    .orderByRaw('customer_id IS NULL, distribution_channel_id IS NULL, valid_from DESC, id DESC')
    .first('id', 'price', 'customer_id', 'distribution_channel_id');
  if (!row) return null;
  return { id: row.id, price: Number(row.price), source: row.customer_id ? 'CUSTOMER' : row.distribution_channel_id ? 'CHANNEL' : 'GENERAL' };
}

export async function determineDiscount(trx, { materialId, salesOrgId, channelId, customerId, date }) {
  const row = await trx('price_discounts')
    .where({ sales_organization_id: salesOrgId, is_active: true })
    .where('valid_from', '<=', date).where('valid_to', '>=', date)
    .where((q) => q.whereNull('customer_id').orWhere('customer_id', customerId))
    .where((q) => q.whereNull('material_id').orWhere('material_id', materialId))
    .where((q) => q.whereNull('distribution_channel_id').orWhere('distribution_channel_id', channelId))
    // Mais específico primeiro: cliente+material, cliente, material, canal, geral.
    .orderByRaw('(customer_id IS NOT NULL AND material_id IS NOT NULL) DESC, customer_id IS NULL, material_id IS NULL, distribution_channel_id IS NULL, id DESC')
    .first('id', 'percent', 'description');
  return row ? { id: row.id, percent: Number(row.percent), description: row.description } : { id: null, percent: 0, description: null };
}

/** Calcula um item de venda: preço, desconto, líquido e imposto. Lança 400 se não houver preço válido. */
export async function priceItem(trx, ctx, { materialId, materialCode, quantity, taxRate, field }) {
  const price = await determinePrice(trx, { ...ctx, materialId });
  if (!price) throw badRequest(`Sem preço válido para o material ${materialCode} nesta organização de vendas e data.`, [{ field, message: 'Cadastre um preço em Condições comerciais.' }]);
  const discount = await determineDiscount(trx, { ...ctx, materialId });
  const gross = money(quantity * price.price);
  const discountAmount = money((gross * discount.percent) / 100);
  const net = money(gross - discountAmount);
  return {
    unit_price: money(price.price),
    price_source: price.source,
    discount_pct: discount.percent,
    discount_amount: discountAmount,
    net_amount: net,
    tax_rate: taxRate,
    tax_amount: money((net * taxRate) / 100),
    list_amount: gross,
  };
}
