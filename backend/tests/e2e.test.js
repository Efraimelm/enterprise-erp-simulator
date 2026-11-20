// Etapa 5 - Integração MM + SD de ponta a ponta e trilha de documentos (cenário 10).
// Um único material percorre: cadastro → requisição → pedido de compra → 2 recebimentos →
// pedido de venda → entrega → saída 601 → fatura → pagamento. Depois a trilha é consultada
// a partir das duas pontas.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { CLIENT_HEADER, createUser, idByCode, loginAs } from './helpers.js';

const H = CLIENT_HEADER;
const today = () => new Date().toISOString().slice(0, 10);
const plus = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

let ids; let agents; let doc;

beforeAll(async () => {
  ids = {
    cf10: await idByCode('plants', 'CF10'),
    cf20: await idByCode('plants', 'CF20'),
    porg: await idByCode('purchasing_organizations', 'CF10'),
    sorg: await idByCode('sales_organizations', 'CF10'),
    ch10: await idByCode('distribution_channels', '10'),
    div01: await idByCode('divisions', '01'),
    f1: await idByCode('suppliers', 'F0001'),
    c1: await idByCode('customers', 'C0001'),
  };
  ids.sla = (await db('storage_locations').where({ plant_id: ids.cf10, code: '0001' }).first('id')).id;
  ids.slb = (await db('storage_locations').where({ plant_id: ids.cf10, code: '0002' }).first('id')).id;
  const cf10 = [{ type: 'PLANT', plant_id: ids.cf10 }];
  agents = {
    admin: await loginAs(await createUser({ roles: ['SAP_ADMIN'] })),
    comprador: await loginAs(await createUser({ roles: ['PROCUREMENT'], scopes: cf10 })),
    gestorMM: await loginAs(await createUser({ roles: ['MM_MANAGER'], scopes: cf10 })),
    almox: await loginAs(await createUser({ roles: ['WAREHOUSE'], scopes: cf10 })),
    vendedor: await loginAs(await createUser({ roles: ['SALES'], scopes: cf10 })),
    analistaSD: await loginAs(await createUser({ roles: ['SD_ANALYST'], scopes: cf10 })),
    gestorSD: await loginAs(await createUser({ roles: ['SD_MANAGER'], scopes: cf10 })),
    auditor: await loginAs(await createUser({ roles: ['AUDITOR'] })),
    cf20: await loginAs(await createUser({ roles: ['SAP_ADMIN'], scopes: [{ type: 'PLANT', plant_id: ids.cf20 }] })),
  };
});
afterAll(() => db.destroy());

async function newProduct({ stock = 0 } = {}) {
  const { admin } = agents;
  const m = (await admin.post('/api/mm/materials').set(H).send({ code: `E2E-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, description: 'Produto ponta a ponta', material_type: 'HAWA', base_unit: 'UN', reference_price: 5 })).body.data;
  await admin.put(`/api/mm/materials/${m.id}/plants/${ids.cf10}`).set(H).send({ default_storage_location_id: ids.sla, min_stock: 0, reorder_point: 0, max_stock: 0 });
  await admin.put(`/api/mm/suppliers/${ids.f1}/materials/${m.id}`).set(H).send({ net_price: 4, lead_time_days: 2 });
  await admin.post('/api/sd/prices').set(H).send({ material_id: m.id, sales_organization_id: ids.sorg, price: 10, valid_from: plus(-1), valid_to: plus(365) });
  if (stock) await admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '561', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sla, quantity: stock, reason: 'Carga para teste de trilha' });
  return m;
}

const nodeKeys = (flow) => flow.nodes.map((n) => n.key);
const byType = (flow, type) => flow.nodes.filter((n) => n.type === type);

describe('cenário completo: da requisição de compra ao pagamento da venda', () => {
  let m;

  it('compra: RC → aprovação → PC → dois recebimentos parciais', async () => {
    const { comprador, gestorMM, almox } = agents;
    m = await newProduct();
    const pr = (await comprador.post('/api/mm/purchase-requisitions').set(H).send({ plant_id: ids.cf10, justification: 'Lançamento de produto', items: [{ material_id: m.id, quantity: 20, need_date: plus(5) }] })).body.data;
    await gestorMM.post(`/api/mm/purchase-requisitions/${pr.id}/approve`).set(H);
    const po = (await comprador.post('/api/mm/purchase-orders/from-requisition').set(H).send({ requisition_id: pr.id, supplier_id: ids.f1, purchasing_organization_id: ids.porg })).body.data;
    expect((await comprador.post(`/api/mm/purchase-orders/${po.id}/submit`).set(H)).body.data.status).toBe('APPROVED'); // 20 × 4 = 80 ≤ 1.000
    const gr1 = (await almox.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: po.id, items: [{ purchase_order_item_id: po.items[0].id, quantity: 10 }] })).body.data;
    const gr2 = (await almox.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: po.id, items: [{ purchase_order_item_id: po.items[0].id, quantity: 10 }] })).body.data;
    expect(gr2.purchase_order_status).toBe('RECEIVED');
    doc = { pr, po, gr1: gr1.doc_number, gr2: gr2.doc_number };
  });

  it('venda: pedido de 15 → reserva → entrega → saída 601 → fatura → pagamento', async () => {
    const { vendedor, almox, analistaSD, gestorSD } = agents;
    const so = (await vendedor.post('/api/sd/sales-orders').set(H).send({
      customer_id: ids.c1, sales_organization_id: ids.sorg, distribution_channel_id: ids.ch10, division_id: ids.div01, plant_id: ids.cf10,
      requested_date: plus(2), items: [{ material_id: m.id, quantity: 15 }],
    })).body.data;
    const confirmed = (await vendedor.post(`/api/sd/sales-orders/${so.id}/submit`).set(H)).body.data;
    expect(confirmed.items[0].confirmed_qty).toBe(15);
    const del = (await almox.post('/api/sd/deliveries').set(H).send({ sales_order_id: so.id, items: [{ sales_order_item_id: confirmed.items[0].id, quantity: 15 }] })).body.data;
    await almox.post(`/api/sd/deliveries/${del.id}/pick`).set(H).send({ items: [{ delivery_item_id: del.items[0].id, picked_qty: 15 }] });
    const posted = (await almox.post(`/api/sd/deliveries/${del.id}/post-goods-issue`).set(H)).body.data;
    const bill = (await analistaSD.post('/api/sd/billing').set(H).send({ delivery_id: del.id })).body.data;
    const pay = (await gestorSD.post(`/api/sd/receivables/${bill.receivable.id}/payments`).set(H).send({ amount: bill.total_gross, payment_date: today(), method: 'PIX' })).body.data;
    expect(pay.status).toBe('PAID');
    Object.assign(doc, { so, del, gi: posted.material_doc_number, bill, ar: bill.receivable, payId: (await db('payments').where({ number: pay.payment_number }).first('id')).id });

    // Estoque do MM depois da venda: 20 recebidos − 15 vendidos.
    const bal = await db('stock_balances').where({ material_id: m.id, storage_location_id: ids.sla }).first();
    expect(bal).toMatchObject({ physical_qty: 5, reserved_qty: 0 });
  });

  it('cenário 10: a trilha a partir do PAGAMENTO chega à REQUISIÇÃO de compra', async () => {
    const res = await agents.admin.get(`/api/flow/PAYMENT/${doc.payId}`);
    expect(res.status).toBe(200);
    const flow = res.body.data;
    const keys = nodeKeys(flow);
    expect(keys).toEqual(expect.arrayContaining([
      `PAYMENT:${doc.payId}`, `RECEIVABLE:${doc.ar.id}`, `BILLING:${doc.bill.id}`, `DELIVERY:${doc.del.id}`, `SALES_ORDER:${doc.so.id}`,
      `MATERIAL_DOC:${doc.gi}`, `MATERIAL_DOC:${doc.gr1}`, `MATERIAL_DOC:${doc.gr2}`, `PURCHASE_ORDER:${doc.po.id}`, `PURCHASE_REQ:${doc.pr.id}`,
    ]));
    expect(flow.hidden).toBe(0);
    expect(flow.note).toMatch(/FIFO simulado/);
  });

  it('FIFO: a saída de 15 veio 10 do 1º recebimento e 5 do 2º', async () => {
    const flow = (await agents.admin.get(`/api/flow/MATERIAL_DOC/${doc.gi}`)).body.data;
    const toGi = flow.edges.filter((e) => e.to === `MATERIAL_DOC:${doc.gi}` && e.from.startsWith('MATERIAL_DOC:'));
    const label = (d) => toGi.find((e) => e.from === `MATERIAL_DOC:${d}`)?.label;
    expect(label(doc.gr1)).toMatch(/^abasteceu 10 UN/);
    expect(label(doc.gr2)).toMatch(/^abasteceu 5 UN/);
  });

  it('a trilha a partir da REQUISIÇÃO chega ao PAGAMENTO (sentido inverso)', async () => {
    const flow = (await agents.admin.get(`/api/flow/PURCHASE_REQ/${doc.pr.id}`)).body.data;
    expect(nodeKeys(flow)).toEqual(expect.arrayContaining([`PAYMENT:${doc.payId}`, `SALES_ORDER:${doc.so.id}`]));
    // Sentido do processo nas arestas: RC → PC → recebimento → saída → … → pagamento
    expect(flow.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: `PURCHASE_REQ:${doc.pr.id}`, to: `PURCHASE_ORDER:${doc.po.id}` }),
      expect.objectContaining({ from: `PURCHASE_ORDER:${doc.po.id}`, to: `MATERIAL_DOC:${doc.gr1}` }),
      expect.objectContaining({ from: `SALES_ORDER:${doc.so.id}`, to: `DELIVERY:${doc.del.id}` }),
      expect.objectContaining({ from: `DELIVERY:${doc.del.id}`, to: `MATERIAL_DOC:${doc.gi}` }),
      expect.objectContaining({ from: `RECEIVABLE:${doc.ar.id}`, to: `PAYMENT:${doc.payId}` }),
    ]));
  });

  it('auditor (só leitura, todos os centros) vê a trilha inteira', async () => {
    const flow = (await agents.auditor.get(`/api/flow/SALES_ORDER/${doc.so.id}`)).body.data;
    expect(byType(flow, 'PURCHASE_REQ')).toHaveLength(1);
    expect(flow.hidden).toBe(0);
  });

  it('vendedor vê a parte de vendas e estoque; compras e financeiro ficam ocultos e contados', async () => {
    const flow = (await agents.vendedor.get(`/api/flow/SALES_ORDER/${doc.so.id}`)).body.data;
    expect(byType(flow, 'SALES_ORDER')).toHaveLength(1);
    expect(byType(flow, 'MATERIAL_DOC').length).toBeGreaterThanOrEqual(3);
    expect(byType(flow, 'PURCHASE_ORDER')).toHaveLength(0);
    expect(byType(flow, 'BILLING')).toHaveLength(0);
    expect(flow.hidden).toBeGreaterThan(0);
  });

  it('usuário de outro centro recebe 403 ao abrir a trilha', async () => {
    const res = await agents.cf20.get(`/api/flow/SALES_ORDER/${doc.so.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUT_OF_SCOPE');
  });

  it('busca global encontra cada documento pelo número, respeitando permissão', async () => {
    const find = async (agent, number) => (await agent.get(`/api/flow/search?q=${number}`)).body.data;
    expect((await find(agents.admin, doc.po.number))[0]).toMatchObject({ type: 'PURCHASE_ORDER', id: doc.po.id });
    expect((await find(agents.admin, doc.gi))[0]).toMatchObject({ type: 'MATERIAL_DOC', id: doc.gi });
    expect((await find(agents.admin, doc.so.number))[0]).toMatchObject({ type: 'SALES_ORDER' });
    expect((await find(agents.admin, doc.bill.number))[0]).toMatchObject({ type: 'BILLING', typeLabel: 'Fatura' });
    expect(await find(agents.vendedor, doc.po.number)).toEqual([]); // vendedor não lê pedidos de compra
    expect(await find(agents.cf20, doc.so.number)).toEqual([]); // fora do escopo
    expect((await agents.admin.get('/api/flow/search?q=abc')).status).toBe(400);
  });

  it('tipo desconhecido e documento inexistente', async () => {
    expect((await agents.admin.get('/api/flow/BANANA/1')).status).toBe(400);
    expect((await agents.admin.get('/api/flow/SALES_ORDER/999999')).status).toBe(404);
  });
});

describe('transferência 311 continua a trilha no outro depósito', () => {
  it('venda pelo depósito 0002 rastreia a carga inicial feita no 0001, sem puxar vendas irmãs', async () => {
    const { admin, vendedor, almox } = agents;
    const m = await newProduct({ stock: 10 }); // 561 no depósito 0001
    const load = (await db('stock_movements').where({ material_id: m.id, movement_type: '561' }).first('doc_number')).doc_number;
    const tr = (await admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '311', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sla, to_storage_location_id: ids.slb, quantity: 6, reason: 'Abastecer a expedição' })).body.data;
    const so = (await vendedor.post('/api/sd/sales-orders').set(H).send({
      customer_id: ids.c1, sales_organization_id: ids.sorg, distribution_channel_id: ids.ch10, division_id: ids.div01, plant_id: ids.cf10,
      requested_date: plus(2), items: [{ material_id: m.id, quantity: 4, storage_location_id: ids.slb }],
    })).body.data;
    const c = (await vendedor.post(`/api/sd/sales-orders/${so.id}/submit`).set(H)).body.data;
    const d = (await almox.post('/api/sd/deliveries').set(H).send({ sales_order_id: so.id, items: [{ sales_order_item_id: c.items[0].id, quantity: 4 }] })).body.data;
    await almox.post(`/api/sd/deliveries/${d.id}/pick`).set(H).send({ items: [{ delivery_item_id: d.items[0].id, picked_qty: 4 }] });
    const gi = (await almox.post(`/api/sd/deliveries/${d.id}/post-goods-issue`).set(H)).body.data.material_doc_number;

    const flow = (await admin.get(`/api/flow/MATERIAL_DOC/${gi}`)).body.data;
    const keys = nodeKeys(flow);
    expect(keys).toEqual(expect.arrayContaining([`MATERIAL_DOC:${tr.doc_number}`, `MATERIAL_DOC:${load}`, `SALES_ORDER:${so.id}`]));
    expect(flow.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: `MATERIAL_DOC:${load}`, to: `MATERIAL_DOC:${tr.doc_number}` }),
      expect.objectContaining({ from: `MATERIAL_DOC:${tr.doc_number}`, to: `MATERIAL_DOC:${gi}` }),
    ]));

    // Segunda venda abastecida pela mesma carga: é "irmã" da primeira e não faz parte da trilha dela.
    const so2 = (await vendedor.post('/api/sd/sales-orders').set(H).send({
      customer_id: ids.c1, sales_organization_id: ids.sorg, distribution_channel_id: ids.ch10, division_id: ids.div01, plant_id: ids.cf10,
      requested_date: plus(2), items: [{ material_id: m.id, quantity: 2, storage_location_id: ids.slb }],
    })).body.data;
    const c2 = (await vendedor.post(`/api/sd/sales-orders/${so2.id}/submit`).set(H)).body.data;
    const d2 = (await almox.post('/api/sd/deliveries').set(H).send({ sales_order_id: so2.id, items: [{ sales_order_item_id: c2.items[0].id, quantity: 2 }] })).body.data;
    await almox.post(`/api/sd/deliveries/${d2.id}/pick`).set(H).send({ items: [{ delivery_item_id: d2.items[0].id, picked_qty: 2 }] });
    await almox.post(`/api/sd/deliveries/${d2.id}/post-goods-issue`).set(H);

    const fromSale = nodeKeys((await admin.get(`/api/flow/SALES_ORDER/${so.id}`)).body.data);
    expect(fromSale).toEqual(expect.arrayContaining([`MATERIAL_DOC:${load}`, `MATERIAL_DOC:${tr.doc_number}`]));
    expect(fromSale).not.toContain(`SALES_ORDER:${so2.id}`);
    const fromLoad = nodeKeys((await admin.get(`/api/flow/MATERIAL_DOC/${load}`)).body.data);
    expect(fromLoad).toEqual(expect.arrayContaining([`SALES_ORDER:${so.id}`, `SALES_ORDER:${so2.id}`])); // a carga abasteceu as duas
  });
});
