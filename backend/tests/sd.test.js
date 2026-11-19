// Etapa 4 - SD: preço, ATP e reserva, aprovação, entrega e saída 601, faturamento, estorno,
// contas a receber, escopo, permissões e concorrência. Cenários de aceitação 4 a 9.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { CLIENT_HEADER, createUser, idByCode, loginAs } from './helpers.js';

const H = CLIENT_HEADER;
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

let ids;
let admin; let vendedor; let analista; let gestor; let gestor2; let almox;

beforeAll(async () => {
  ids = {
    cf10: await idByCode('plants', 'CF10'),
    cf20: await idByCode('plants', 'CF20'),
    so: await idByCode('sales_organizations', 'CF10'),
    ch10: await idByCode('distribution_channels', '10'),
    ch20: await idByCode('distribution_channels', '20'),
    div01: await idByCode('divisions', '01'),
    c1: await idByCode('customers', 'C0001'),
    c2: await idByCode('customers', 'C0002'),
    c3: await idByCode('customers', 'C0003'),
  };
  ids.sl10 = (await db('storage_locations').where({ plant_id: ids.cf10, code: '0001' }).first('id')).id;
  const cf10 = [{ type: 'PLANT', plant_id: ids.cf10 }];
  admin = await loginAs(await createUser({ roles: ['SAP_ADMIN'] }));
  vendedor = await loginAs(await createUser({ roles: ['SALES'], scopes: cf10 }));
  analista = await loginAs(await createUser({ roles: ['SD_ANALYST'], scopes: cf10 }));
  gestor = await loginAs(await createUser({ roles: ['SD_MANAGER'], scopes: cf10 }));
  gestor2 = await loginAs(await createUser({ roles: ['SD_MANAGER'], scopes: cf10 }));
  almox = await loginAs(await createUser({ roles: ['WAREHOUSE'], scopes: cf10 }));
});
afterAll(() => db.destroy());

/** Material vendável no CF10: estoque inicial (561) e preço geral na org. de vendas CF10. */
async function sellable({ stock = 0, price = 10 } = {}) {
  const m = (await admin.post('/api/mm/materials').set(H).send({ code: `V-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, description: 'Produto de venda', material_type: 'HAWA', base_unit: 'UN', reference_price: price / 2 })).body.data;
  await admin.put(`/api/mm/materials/${m.id}/plants/${ids.cf10}`).set(H).send({ default_storage_location_id: ids.sl10, min_stock: 0, reorder_point: 0, max_stock: 0 });
  if (stock) await admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '561', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sl10, quantity: stock, reason: 'Estoque para teste de venda' });
  await admin.post('/api/sd/prices').set(H).send({ material_id: m.id, sales_organization_id: ids.so, price, valid_from: plusDays(today(), -30), valid_to: plusDays(today(), 365) });
  return m;
}
const balance = async (materialId) => db('stock_balances').where({ material_id: materialId, storage_location_id: ids.sl10 }).first('physical_qty', 'reserved_qty');
const order = (items, extra = {}) => ({
  customer_id: ids.c1, sales_organization_id: ids.so, distribution_channel_id: ids.ch10, division_id: ids.div01, plant_id: ids.cf10,
  requested_date: plusDays(today(), 3), items, ...extra,
});
/** Cria e envia um pedido; devolve o pedido confirmado. */
async function confirmedOrder(agent, items, extra) {
  const so = (await agent.post('/api/sd/sales-orders').set(H).send(order(items, extra))).body.data;
  return (await agent.post(`/api/sd/sales-orders/${so.id}/submit`).set(H)).body.data;
}
/** Entrega → separação → saída (601). */
async function shipped(agent, so, quantities) {
  const d = (await agent.post('/api/sd/deliveries').set(H).send({ sales_order_id: so.id, items: so.items.map((i, k) => ({ sales_order_item_id: i.id, quantity: quantities[k] })) })).body.data;
  await agent.post(`/api/sd/deliveries/${d.id}/pick`).set(H).send({ items: d.items.map((i) => ({ delivery_item_id: i.id, picked_qty: i.quantity })) });
  return (await agent.post(`/api/sd/deliveries/${d.id}/post-goods-issue`).set(H)).body.data;
}

describe('preço e desconto (registros de condição)', () => {
  it('preço do cliente vence o do canal, que vence o geral', async () => {
    const m = await sellable({ price: 10 });
    const base = { material_id: m.id, sales_organization_id: ids.so, valid_from: plusDays(today(), -1), valid_to: plusDays(today(), 30) };
    await admin.post('/api/sd/prices').set(H).send({ ...base, distribution_channel_id: ids.ch20, price: 9 });
    await admin.post('/api/sd/prices').set(H).send({ ...base, customer_id: ids.c2, price: 8 });
    const sim = (c, ch) => admin.get(`/api/sd/price-simulation?material_id=${m.id}&sales_organization_id=${ids.so}&distribution_channel_id=${ch}&customer_id=${c}`).then((r) => r.body.data.price);
    expect(await sim(ids.c1, ids.ch10)).toMatchObject({ price: 10, source: 'GENERAL' });
    expect(await sim(ids.c1, ids.ch20)).toMatchObject({ price: 9, source: 'CHANNEL' });
    expect(await sim(ids.c2, ids.ch20)).toMatchObject({ price: 8, source: 'CUSTOMER' });
  });

  it('desconto mais específico vale (cliente+material > canal) e não soma', async () => {
    const arroz = await idByCode('materials', 'ALM-0001');
    const sim = await admin.get(`/api/sd/price-simulation?material_id=${arroz}&sales_organization_id=${ids.so}&distribution_channel_id=${ids.ch20}&customer_id=${ids.c2}`);
    expect(sim.body.data.discount.percent).toBe(8); // campanha do Atacadão, não os 3% do atacado
    const other = await admin.get(`/api/sd/price-simulation?material_id=${await idByCode('materials', 'ALM-0002')}&sales_organization_id=${ids.so}&distribution_channel_id=${ids.ch20}&customer_id=${ids.c2}`);
    expect(other.body.data.discount.percent).toBe(3);
  });

  it('preço com validade invertida é recusado', async () => {
    const res = await admin.post('/api/sd/prices').set(H).send({ material_id: (await sellable()).id, sales_organization_id: ids.so, price: 1, valid_from: today(), valid_to: plusDays(today(), -1) });
    expect(res.status).toBe(400);
  });
});

describe('cenário 4: pedido de venda com verificação de disponibilidade', () => {
  it('ATP mostra disponível, confirmável e falta, sem reservar', async () => {
    const m = await sellable({ stock: 50 });
    const res = await vendedor.post('/api/sd/atp').set(H).send({ plant_id: ids.cf10, items: [{ material_id: m.id, quantity: 80 }] });
    expect(res.body.data[0]).toMatchObject({ available: 50, confirmable: 50, shortfall: 30 });
    expect((await balance(m.id)).reserved_qty).toBe(0);
  });

  it('pedido calcula preço, imposto padrão (18%) e nasce como rascunho com numeração 00…', async () => {
    const m = await sellable({ stock: 50, price: 10 });
    const res = await vendedor.post('/api/sd/sales-orders').set(H).send(order([{ material_id: m.id, quantity: 20 }]));
    expect(res.status).toBe(201);
    expect(res.body.data.number).toMatch(/^00\d{8}$/);
    expect(res.body.data).toMatchObject({ status: 'DRAFT', total_net: 200, total_tax: 36, total_gross: 236, currency: 'BRL' });
    expect(res.body.data.items[0]).toMatchObject({ unit_price: 10, price_source: 'GENERAL', tax_rate: 18, sloc_code: '0001' });
  });

  it('valida cliente na área de vendas, cliente bloqueado e material sem preço', async () => {
    const m = await sellable({ stock: 5 });
    // C0003 (padaria) só compra no varejo (canal 10)
    expect((await vendedor.post('/api/sd/sales-orders').set(H).send(order([{ material_id: m.id, quantity: 1 }], { customer_id: ids.c3, distribution_channel_id: ids.ch20 }))).status).toBe(400);
    const semPreco = (await admin.post('/api/mm/materials').set(H).send({ code: `NP-${crypto.randomBytes(2).toString('hex')}`, description: 'Sem preço', material_type: 'HAWA', base_unit: 'UN', reference_price: 1 })).body.data;
    await admin.put(`/api/mm/materials/${semPreco.id}/plants/${ids.cf10}`).set(H).send({ default_storage_location_id: ids.sl10, min_stock: 0, reorder_point: 0, max_stock: 0 });
    const res = await vendedor.post('/api/sd/sales-orders').set(H).send(order([{ material_id: semPreco.id, quantity: 1 }]));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Sem preço/);
  });
});

describe('cenário 5: confirmar pedido e reservar estoque', () => {
  it('até o limite confirma direto e reserva no depósito', async () => {
    const m = await sellable({ stock: 50 });
    const so = await confirmedOrder(vendedor, [{ material_id: m.id, quantity: 20 }]);
    expect(so).toMatchObject({ status: 'CONFIRMED', auto_approved: true });
    expect(so.items[0]).toMatchObject({ confirmed_qty: 20, open_reserved_qty: 20, deliverable_qty: 20 });
    expect(await balance(m.id)).toMatchObject({ physical_qty: 50, reserved_qty: 20 });
    const stock = (await vendedor.get(`/api/mm/stock?material_id=${m.id}`)).body.data[0];
    expect(stock.available_qty).toBe(30);
  });

  it('atendimento parcial confirma o que há e reconfirma quando o estoque chega', async () => {
    const m = await sellable({ stock: 30 });
    const so = await confirmedOrder(vendedor, [{ material_id: m.id, quantity: 40 }]);
    expect(so.items[0]).toMatchObject({ confirmed_qty: 30, unconfirmed_qty: 10 });
    await admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '561', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sl10, quantity: 20, reason: 'Chegada de mercadoria' });
    const again = await vendedor.post(`/api/sd/sales-orders/${so.id}/reconfirm`).set(H);
    expect(again.body.data.items[0]).toMatchObject({ confirmed_qty: 40, unconfirmed_qty: 0 });
    expect((await balance(m.id)).reserved_qty).toBe(40);
  });

  it('sem atendimento parcial, falta de estoque recusa e não reserva nada', async () => {
    const m = await sellable({ stock: 5 });
    const so = (await vendedor.post('/api/sd/sales-orders').set(H).send(order([{ material_id: m.id, quantity: 8 }], { allow_partial: false }))).body.data;
    const res = await vendedor.post(`/api/sd/sales-orders/${so.id}/submit`).set(H);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await vendedor.get(`/api/sd/sales-orders/${so.id}`)).body.data.status).toBe('DRAFT');
    expect((await balance(m.id)).reserved_qty).toBe(0);
  });

  it('concorrência: dois pedidos de 8 sobre 10 em paralelo — só um reserva', async () => {
    const m = await sellable({ stock: 10 });
    const a = (await vendedor.post('/api/sd/sales-orders').set(H).send(order([{ material_id: m.id, quantity: 8 }], { allow_partial: false }))).body.data;
    const b = (await vendedor.post('/api/sd/sales-orders').set(H).send(order([{ material_id: m.id, quantity: 8 }], { allow_partial: false }))).body.data;
    const results = await Promise.all([a, b].map((so) => vendedor.post(`/api/sd/sales-orders/${so.id}/submit`).set(H)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await balance(m.id)).toMatchObject({ physical_qty: 10, reserved_qty: 8 });
  });

  it('acima do limite aguarda aprovação; criador e vendedor não aprovam; gestor aprova e reserva', async () => {
    const m = await sellable({ stock: 1000, price: 100 });
    const so = (await gestor.post('/api/sd/sales-orders').set(H).send(order([{ material_id: m.id, quantity: 60 }]))).body.data; // 6.000 + 18%
    expect((await gestor.post(`/api/sd/sales-orders/${so.id}/submit`).set(H)).body.data.status).toBe('PENDING_APPROVAL');
    expect((await balance(m.id)).reserved_qty).toBe(0);
    expect((await gestor.post(`/api/sd/sales-orders/${so.id}/approve`).set(H)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await vendedor.post(`/api/sd/sales-orders/${so.id}/approve`).set(H)).status).toBe(403);
    const ok = await gestor2.post(`/api/sd/sales-orders/${so.id}/approve`).set(H);
    expect(ok.body.data).toMatchObject({ status: 'CONFIRMED', approved_by_username: expect.any(String) });
    expect((await balance(m.id)).reserved_qty).toBe(60);
  });

  it('cancelar pedido confirmado libera a reserva', async () => {
    const m = await sellable({ stock: 20 });
    const so = await confirmedOrder(vendedor, [{ material_id: m.id, quantity: 15 }]);
    expect((await vendedor.post(`/api/sd/sales-orders/${so.id}/cancel`).set(H).send({ reason: 'Cliente desistiu' })).status).toBe(403);
    const res = await gestor.post(`/api/sd/sales-orders/${so.id}/cancel`).set(H).send({ reason: 'Cliente desistiu' });
    expect(res.body.data.status).toBe('CANCELLED');
    expect((await balance(m.id)).reserved_qty).toBe(0);
  });
});

describe('cenários 6 e 7: entrega parcial, saída de mercadoria e estoque do MM', () => {
  let so; let m; let delivery;

  beforeAll(async () => {
    m = await sellable({ stock: 50 });
    so = await confirmedOrder(vendedor, [{ material_id: m.id, quantity: 20 }]);
  });

  it('não entrega mais que o confirmado', async () => {
    const res = await almox.post('/api/sd/deliveries').set(H).send({ sales_order_id: so.id, items: [{ sales_order_item_id: so.items[0].id, quantity: 21 }] });
    expect(res.status).toBe(400);
  });

  it('entrega parcial de 12: pedido "em entrega"; sem separação não lança saída', async () => {
    const res = await almox.post('/api/sd/deliveries').set(H).send({ sales_order_id: so.id, items: [{ sales_order_item_id: so.items[0].id, quantity: 12 }] });
    expect(res.status).toBe(201);
    delivery = res.body.data;
    expect(delivery.number).toMatch(/^80\d{8}$/);
    expect((await vendedor.get(`/api/sd/sales-orders/${so.id}`)).body.data.status).toBe('IN_DELIVERY');
    expect((await almox.post(`/api/sd/deliveries/${delivery.id}/post-goods-issue`).set(H)).body.error.code).toBe('INVALID_STATUS');
  });

  it('separação + saída 601: físico −12 e reservado −12; pedido parcialmente entregue', async () => {
    await almox.post(`/api/sd/deliveries/${delivery.id}/pick`).set(H).send({ items: [{ delivery_item_id: delivery.items[0].id, picked_qty: 12 }] });
    const res = await almox.post(`/api/sd/deliveries/${delivery.id}/post-goods-issue`).set(H);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'POSTED', material_doc_number: expect.stringMatching(/^49\d{8}$/), posted_by_username: expect.any(String) });
    expect(await balance(m.id)).toMatchObject({ physical_qty: 38, reserved_qty: 8 });
    const mv = (await analista.get(`/api/mm/stock/movements?doc_number=${res.body.data.material_doc_number}`)).body.data[0];
    expect(mv).toMatchObject({ movement_type: '601', quantity: -12, reference_type: 'DELIVERY' });
    const detail = (await vendedor.get(`/api/sd/sales-orders/${so.id}`)).body.data;
    expect(detail.status).toBe('PARTIALLY_DELIVERED');
    expect(detail.items[0]).toMatchObject({ delivered_qty: 12, deliverable_qty: 8 });
  });

  it('separação menor que a entrega deixa o restante reservado no pedido', async () => {
    const d = (await almox.post('/api/sd/deliveries').set(H).send({ sales_order_id: so.id, items: [{ sales_order_item_id: so.items[0].id, quantity: 8 }] })).body.data;
    await almox.post(`/api/sd/deliveries/${d.id}/pick`).set(H).send({ items: [{ delivery_item_id: d.items[0].id, picked_qty: 5 }] });
    await almox.post(`/api/sd/deliveries/${d.id}/post-goods-issue`).set(H);
    expect(await balance(m.id)).toMatchObject({ physical_qty: 33, reserved_qty: 3 });
    expect((await vendedor.get(`/api/sd/sales-orders/${so.id}`)).body.data.items[0]).toMatchObject({ delivered_qty: 17, deliverable_qty: 3 });
  });

  it('entrega não lançada pode ser excluída; lançada não', async () => {
    const d = (await almox.post('/api/sd/deliveries').set(H).send({ sales_order_id: so.id, items: [{ sales_order_item_id: so.items[0].id, quantity: 3 }] })).body.data;
    expect((await almox.delete(`/api/sd/deliveries/${d.id}`).set(H)).status).toBe(204);
    expect((await almox.delete(`/api/sd/deliveries/${delivery.id}`).set(H)).status).toBe(409);
  });
});

describe('cenários 8 e 9: faturar, gerar título, receber e quitar; estorno', () => {
  let so; let delivery; let invoice;

  beforeAll(async () => {
    const m = await sellable({ stock: 30, price: 10 });
    so = await confirmedOrder(vendedor, [{ material_id: m.id, quantity: 12 }]);
    delivery = await shipped(almox, so, [12]);
  });

  it('fatura a entrega com os preços do pedido e gera o título com vencimento pela condição (30 dias)', async () => {
    const res = await analista.post('/api/sd/billing').set(H).send({ delivery_id: delivery.id });
    expect(res.status).toBe(201);
    invoice = res.body.data;
    expect(invoice.number).toMatch(/^90\d{8}$/);
    expect(invoice).toMatchObject({ type: 'INVOICE', status: 'ACTIVE', total_net: 120, total_tax: 21.6, total_gross: 141.6 });
    expect(invoice.receivable).toMatchObject({ amount: 141.6, paid_amount: 0, status: 'OPEN', due_date: plusDays(today(), 30) });
    expect((await vendedor.get(`/api/sd/sales-orders/${so.id}`)).body.data.status).toBe('BILLED');
  });

  it('não fatura duas vezes a mesma entrega', async () => {
    expect((await analista.post('/api/sd/billing').set(H).send({ delivery_id: delivery.id })).body.error.code).toBe('ALREADY_BILLED');
  });

  it('pagamento parcial, valor acima do saldo recusado, e quitação', async () => {
    const arId = invoice.receivable.id;
    const p1 = await gestor.post(`/api/sd/receivables/${arId}/payments`).set(H).send({ amount: 100, payment_date: today(), method: 'PIX' });
    expect(p1.body.data).toMatchObject({ status: 'PARTIALLY_PAID', open_amount: 41.6, payment_number: expect.stringMatching(/^14\d{8}$/) });
    expect((await gestor.post(`/api/sd/receivables/${arId}/payments`).set(H).send({ amount: 50, payment_date: today(), method: 'PIX' })).status).toBe(400);
    const p2 = await gestor.post(`/api/sd/receivables/${arId}/payments`).set(H).send({ amount: 41.6, payment_date: today(), method: 'BOLETO' });
    expect(p2.body.data).toMatchObject({ status: 'PAID', open_amount: 0 });
    const detail = (await gestor.get(`/api/sd/receivables/${arId}`)).body.data;
    expect(detail.payments).toHaveLength(2);
  });

  it('fatura com pagamento não pode ser estornada', async () => {
    expect((await gestor.post(`/api/sd/billing/${invoice.id}/cancel`).set(H).send({ reason: 'Erro' })).body.error.code).toBe('HAS_PAYMENTS');
  });

  it('estorno gera documento negativo, cancela o título e permite faturar de novo', async () => {
    const m = await sellable({ stock: 10, price: 10 });
    const so2 = await confirmedOrder(vendedor, [{ material_id: m.id, quantity: 5 }]);
    const d2 = await shipped(almox, so2, [5]);
    const inv = (await analista.post('/api/sd/billing').set(H).send({ delivery_id: d2.id })).body.data;
    expect((await analista.post(`/api/sd/billing/${inv.id}/cancel`).set(H).send({ reason: 'Preço errado' })).status).toBe(403); // analista não estorna
    const res = await gestor.post(`/api/sd/billing/${inv.id}/cancel`).set(H).send({ reason: 'Preço errado' });
    expect(res.body.data).toMatchObject({ type: 'CANCELLATION', total_gross: -59, reference_number: inv.number });
    const original = (await gestor.get(`/api/sd/billing/${inv.id}`)).body.data;
    expect(original).toMatchObject({ status: 'CANCELLED', cancellation: expect.objectContaining({ number: res.body.data.number }) });
    expect(original.receivable.status).toBe('CANCELLED');
    expect((await vendedor.get(`/api/sd/sales-orders/${so2.id}`)).body.data.status).toBe('DELIVERED');
    expect((await analista.post('/api/sd/billing').set(H).send({ delivery_id: d2.id })).status).toBe(201);
  });

  it('título vencido aparece como atrasado', async () => {
    const m = await sellable({ stock: 5, price: 10 });
    const so3 = await confirmedOrder(vendedor, [{ material_id: m.id, quantity: 1 }]);
    const d3 = await shipped(almox, so3, [1]);
    const inv = (await analista.post('/api/sd/billing').set(H).send({ delivery_id: d3.id, billing_date: plusDays(today(), -40) })).body.data;
    expect(inv.receivable.due_date).toBe(plusDays(today(), -10));
    const list = (await gestor.get('/api/sd/receivables?overdue=true&pageSize=100')).body.data;
    expect(list.find((r) => r.id === inv.receivable.id)).toMatchObject({ overdue: true });
  });
});

describe('permissões, escopo e consistência', () => {
  it('almoxarife não cria pedido de venda; vendedor não cria entrega nem fatura', async () => {
    expect((await almox.post('/api/sd/sales-orders').set(H).send({})).status).toBe(403);
    expect((await vendedor.post('/api/sd/deliveries').set(H).send({})).status).toBe(403);
    expect((await vendedor.post('/api/sd/billing').set(H).send({})).status).toBe(403);
    expect((await vendedor.get('/api/sd/receivables')).status).toBe(403);
  });

  it('almoxarife não altera cadastro de cliente (cenário 11)', async () => {
    expect((await almox.put(`/api/sd/customers/${ids.c1}`).set(H).send({})).status).toBe(403);
  });

  it('vendedor do CF10 não vende pelo CF20 nem vê pedidos do CF20', async () => {
    const m = await sellable();
    const res = await vendedor.post('/api/sd/sales-orders').set(H).send(order([{ material_id: m.id, quantity: 1 }], { plant_id: ids.cf20 }));
    expect(res.body.error.code).toBe('OUT_OF_SCOPE');
    const list = (await vendedor.get('/api/sd/sales-orders?pageSize=100')).body.data;
    expect(list.every((o) => o.plant_code === 'CF10')).toBe(true);
  });

  it('reservado de cada depósito = soma de (confirmado − entregue) dos pedidos não cancelados', async () => {
    const [rows] = await db.raw(`
      SELECT b.material_id, b.storage_location_id, b.reserved_qty,
             COALESCE((SELECT SUM(i.confirmed_qty - i.delivered_qty) FROM sales_order_items i JOIN sales_orders o ON o.id = i.sales_order_id
                       WHERE o.status <> 'CANCELLED' AND i.material_id = b.material_id AND i.storage_location_id = b.storage_location_id), 0) AS expected
      FROM stock_balances b`);
    const wrong = rows.filter((r) => Math.abs(Number(r.reserved_qty) - Number(r.expected)) > 1e-6);
    expect(wrong).toEqual([]);
  });

  it('saldo físico continua igual à soma dos movimentos (MM + SD)', async () => {
    const diff = await db.raw(`
      SELECT COUNT(*) AS n FROM stock_balances b
      WHERE b.physical_qty <> (SELECT COALESCE(SUM(mv.quantity), 0) FROM stock_movements mv
                               WHERE mv.material_id = b.material_id AND mv.storage_location_id = b.storage_location_id)`);
    expect(Number(diff[0][0].n)).toBe(0);
  });
});
