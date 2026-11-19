// Etapa 3 - MM: cadastros, requisição → pedido → recebimento, estoque, inventário, MRP,
// separação de funções, escopo e concorrência. Cenários de aceitação 1, 2, 3, 11, 12 e 13.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { CLIENT_HEADER, createUser, idByCode, loginAs } from './helpers.js';

const H = CLIENT_HEADER;
const future = (days = 10) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
const code = (p) => `${p}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

let ids;
let admin; // SAP_ADMIN, escopo ALL
let gestor; // MM_MANAGER CF10 (aprova, recebe acima do pedido)
let gestor2; // outro MM_MANAGER CF10
let comprador; // PROCUREMENT CF10
let almox; // WAREHOUSE CF10
let analista; // MM_ANALYST CF10
let vendedor; // SALES CF10

beforeAll(async () => {
  ids = {
    cf10: await idByCode('plants', 'CF10'),
    cf20: await idByCode('plants', 'CF20'),
    org: await idByCode('purchasing_organizations', 'CF10'),
    f1: await idByCode('suppliers', 'F0001'),
    f2: await idByCode('suppliers', 'F0002'),
    arroz: await idByCode('materials', 'ALM-0001'),
    i2: await idByCode('tax_codes', 'I2'),
  };
  ids.sl10a = (await db('storage_locations').where({ plant_id: ids.cf10, code: '0001' }).first('id')).id;
  ids.sl10b = (await db('storage_locations').where({ plant_id: ids.cf10, code: '0002' }).first('id')).id;
  ids.sl20a = (await db('storage_locations').where({ plant_id: ids.cf20, code: '0001' }).first('id')).id;

  const cf10 = [{ type: 'PLANT', plant_id: ids.cf10 }];
  admin = await loginAs(await createUser({ roles: ['SAP_ADMIN'] }));
  gestor = await loginAs(await createUser({ roles: ['MM_MANAGER'], scopes: cf10 }));
  gestor2 = await loginAs(await createUser({ roles: ['MM_MANAGER'], scopes: cf10 }));
  comprador = await loginAs(await createUser({ roles: ['PROCUREMENT'], scopes: cf10 }));
  almox = await loginAs(await createUser({ roles: ['WAREHOUSE'], scopes: cf10 }));
  analista = await loginAs(await createUser({ roles: ['MM_ANALYST'], scopes: cf10 }));
  vendedor = await loginAs(await createUser({ roles: ['SALES'], scopes: cf10 }));
});
afterAll(() => db.destroy());

/** Cria um material estendido para o CF10 (e opcionalmente com estoque inicial via 561). */
async function newMaterial({ rop = 0, max = 0, stock = 0, price = 10 } = {}) {
  const m = (await admin.post('/api/mm/materials').set(H).send({ code: code('T'), description: 'Material de teste', material_type: 'HAWA', base_unit: 'UN', reference_price: price })).body.data;
  await admin.put(`/api/mm/materials/${m.id}/plants/${ids.cf10}`).set(H).send({ default_storage_location_id: ids.sl10a, min_stock: 0, reorder_point: rop, max_stock: max });
  if (stock) {
    await admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '561', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sl10a, quantity: stock, reason: 'Estoque inicial de teste' });
  }
  return m;
}
const balance = async (materialId, slocId = ids.sl10a) =>
  (await db('stock_balances').where({ material_id: materialId, storage_location_id: slocId }).first())?.physical_qty ?? 0;

const poBody = (items, extra = {}) => ({
  supplier_id: ids.f1, purchasing_organization_id: ids.org, plant_id: ids.cf10, delivery_date: future(), items, ...extra,
});

describe('cenário 1: cadastrar material e consultar no MM', () => {
  it('cria, estende para o centro e consulta com dados do centro, estoque e histórico', async () => {
    const m = await newMaterial({ rop: 5, max: 20, stock: 7 });
    const res = await comprador.get(`/api/mm/materials/${m.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ code: m.code, status: 'ACTIVE', base_unit: 'UN' });
    expect(res.body.data.plants).toEqual([expect.objectContaining({ plant_code: 'CF10', reorder_point: 5, max_stock: 20 })]);
    expect(res.body.data.stock[0]).toMatchObject({ sloc_code: '0001', physical_qty: 7, available_qty: 7 });
    expect(res.body.data.history.map((h) => h.action)).toEqual(expect.arrayContaining(['CREATE']));
  });

  it('valida unidade, preço e código duplicado', async () => {
    const bad = await admin.post('/api/mm/materials').set(H).send({ code: 'X1', description: 'X', material_type: 'HAWA', base_unit: 'XX', reference_price: -1 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((d) => d.field).sort()).toEqual(['base_unit', 'reference_price']);
    const dup = await admin.post('/api/mm/materials').set(H).send({ code: 'ALM-0001', description: 'Dup', material_type: 'HAWA', base_unit: 'UN', reference_price: 1 });
    expect(dup.status).toBe(409);
  });

  it('material bloqueado não entra em novos documentos', async () => {
    const m = await newMaterial();
    await admin.post(`/api/mm/materials/${m.id}/status`).set(H).send({ status: 'BLOCKED', reason: 'Recall do lote' });
    const res = await comprador.post('/api/mm/purchase-requisitions').set(H).send({ plant_id: ids.cf10, justification: 'Teste', items: [{ material_id: m.id, quantity: 1, need_date: future() }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/bloqueado/);
  });

  it('fornecedor com registro info aparece no material e vice-versa', async () => {
    const s = (await admin.post('/api/mm/suppliers').set(H).send({ code: code('S').replace('-', '').slice(0, 10), name: 'Fornecedor Teste', legal_name: 'Fornecedor Teste Ltda', state: 'sp', overdelivery_tolerance_pct: 3 })).body.data;
    expect(s.state).toBe('SP');
    const m = await newMaterial();
    await admin.put(`/api/mm/suppliers/${s.id}/materials/${m.id}`).set(H).send({ net_price: 9.99, lead_time_days: 4 });
    expect((await admin.get(`/api/mm/suppliers/${s.id}`)).body.data.materials[0]).toMatchObject({ material_id: m.id, net_price: 9.99 });
    expect((await admin.get(`/api/mm/materials/${m.id}`)).body.data.suppliers[0]).toMatchObject({ id: s.id, net_price: 9.99 });
  });
});

describe('cenário 2: requisição → aprovação → pedido', () => {
  let pr;

  it('comprador cria a requisição com numeração 10xxxxxxxx', async () => {
    const res = await comprador.post('/api/mm/purchase-requisitions').set(H).send({
      plant_id: ids.cf10, justification: 'Reposição de arroz', items: [{ material_id: ids.arroz, quantity: 30, need_date: future(5) }],
    });
    expect(res.status).toBe(201);
    pr = res.body.data;
    expect(pr.number).toMatch(/^10\d{8}$/);
    expect(pr).toMatchObject({ status: 'PENDING_APPROVAL', source: 'MANUAL' });
    expect(pr.items[0]).toMatchObject({ item_no: 10, quantity: 30, sloc_code: '0001', estimated_price: 21.5 });
  });

  it('comprador não aprova (sem permissão) e analista também não', async () => {
    expect((await comprador.post(`/api/mm/purchase-requisitions/${pr.id}/approve`).set(H)).status).toBe(403);
    expect((await analista.post(`/api/mm/purchase-requisitions/${pr.id}/approve`).set(H)).status).toBe(403);
  });

  it('gestor não aprova a própria requisição (separação de funções)', async () => {
    const own = (await gestor.post('/api/mm/purchase-requisitions').set(H).send({ plant_id: ids.cf10, justification: 'Própria', items: [{ material_id: ids.arroz, quantity: 1, need_date: future() }] })).body.data;
    const res = await gestor.post(`/api/mm/purchase-requisitions/${own.id}/approve`).set(H);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SEGREGATION_OF_DUTIES');
  });

  it('gestor aprova; não dá para aprovar de novo', async () => {
    const res = await gestor.post(`/api/mm/purchase-requisitions/${pr.id}/approve`).set(H);
    expect(res.body.data.status).toBe('APPROVED');
    expect((await gestor2.post(`/api/mm/purchase-requisitions/${pr.id}/approve`).set(H)).body.error.code).toBe('INVALID_STATUS');
  });

  it('converte em pedido com preço do registro info e imposto simulado', async () => {
    const res = await comprador.post('/api/mm/purchase-orders/from-requisition').set(H).send({
      requisition_id: pr.id, supplier_id: ids.f1, purchasing_organization_id: ids.org, tax_code_id: ids.i2,
    });
    expect(res.status).toBe(201);
    const po = res.body.data;
    expect(po.number).toMatch(/^45\d{8}$/);
    expect(po).toMatchObject({ status: 'DRAFT', currency: 'BRL', total_net: 645, total_tax: 116.1, total_gross: 761.1 });
    expect(po.items[0]).toMatchObject({ unit_price: 21.5, tax_rate: 18, quantity: 30, open_qty: 30 });
    expect(po.requisitions).toEqual([expect.objectContaining({ number: pr.number, status: 'CONVERTED' })]);
    const prNow = (await comprador.get(`/api/mm/purchase-requisitions/${pr.id}`)).body.data;
    expect(prNow.items[0].purchase_order_number).toBe(po.number);
  });

  it('requisição rejeitada exige motivo e não vira pedido', async () => {
    const r = (await comprador.post('/api/mm/purchase-requisitions').set(H).send({ plant_id: ids.cf10, justification: 'X', items: [{ material_id: ids.arroz, quantity: 2, need_date: future() }] })).body.data;
    expect((await gestor.post(`/api/mm/purchase-requisitions/${r.id}/reject`).set(H).send({})).status).toBe(400);
    expect((await gestor.post(`/api/mm/purchase-requisitions/${r.id}/reject`).set(H).send({ reason: 'Sem orçamento' })).body.data.status).toBe('REJECTED');
    const conv = await comprador.post('/api/mm/purchase-orders/from-requisition').set(H).send({ requisition_id: r.id, supplier_id: ids.f1, purchasing_organization_id: ids.org });
    expect(conv.status).toBe(409);
  });
});

describe('pedido de compra: aprovação por valor e ciclo de vida', () => {
  it('total até o limite é aprovado automaticamente', async () => {
    const po = (await comprador.post('/api/mm/purchase-orders').set(H).send(poBody([{ material_id: ids.arroz, quantity: 10 }]))).body.data;
    expect(po.total_gross).toBe(215);
    const res = await comprador.post(`/api/mm/purchase-orders/${po.id}/submit`).set(H);
    expect(res.body.data).toMatchObject({ status: 'APPROVED', auto_approved: true });
  });

  it('acima do limite vai para aprovação; criador não aprova; outro gestor aprova', async () => {
    const po = (await gestor.post('/api/mm/purchase-orders').set(H).send(poBody([{ material_id: ids.arroz, quantity: 100, tax_code_id: ids.i2 }]))).body.data;
    expect(po.total_gross).toBe(2537);
    expect((await gestor.post(`/api/mm/purchase-orders/${po.id}/submit`).set(H)).body.data.status).toBe('PENDING_APPROVAL');
    expect((await gestor.post(`/api/mm/purchase-orders/${po.id}/approve`).set(H)).body.error.code).toBe('SEGREGATION_OF_DUTIES');
    expect((await comprador.post(`/api/mm/purchase-orders/${po.id}/approve`).set(H)).status).toBe(403);
    const ok = await gestor2.post(`/api/mm/purchase-orders/${po.id}/approve`).set(H);
    expect(ok.body.data).toMatchObject({ status: 'APPROVED', approved_by_username: expect.any(String) });
    expect((await comprador.post(`/api/mm/purchase-orders/${po.id}/send`).set(H)).body.data.status).toBe('SENT');
  });

  it('rejeição volta para rascunho; só rascunho pode ser alterado', async () => {
    const po = (await comprador.post('/api/mm/purchase-orders').set(H).send(poBody([{ material_id: ids.arroz, quantity: 100 }]))).body.data;
    await comprador.post(`/api/mm/purchase-orders/${po.id}/submit`).set(H);
    const edit = await comprador.put(`/api/mm/purchase-orders/${po.id}`).set(H).send(poBody([{ material_id: ids.arroz, quantity: 5 }]));
    expect(edit.body.error.code).toBe('INVALID_STATUS');
    const rej = await gestor.post(`/api/mm/purchase-orders/${po.id}/reject`).set(H).send({ reason: 'Quantidade alta' });
    expect(rej.body.data).toMatchObject({ status: 'DRAFT', status_note: 'Rejeitado: Quantidade alta' });
    const edited = await comprador.put(`/api/mm/purchase-orders/${po.id}`).set(H).send(poBody([{ material_id: ids.arroz, quantity: 5, unit_price: 20 }]));
    expect(edited.body.data).toMatchObject({ total_gross: 100, status: 'DRAFT' });
  });

  it('valida organização de compras do centro, depósito do centro e fornecedor ativo', async () => {
    const wrongSloc = await comprador.post('/api/mm/purchase-orders').set(H).send(poBody([{ material_id: ids.arroz, quantity: 1, storage_location_id: ids.sl20a }]));
    expect(wrongSloc.status).toBe(400);
    const s = (await admin.post('/api/mm/suppliers').set(H).send({ code: code('B').replace('-', '').slice(0, 10), name: 'Bloq', legal_name: 'Bloq Ltda', overdelivery_tolerance_pct: 0 })).body.data;
    await admin.post(`/api/mm/suppliers/${s.id}/status`).set(H).send({ status: 'BLOCKED', reason: 'Pendência fiscal' });
    expect((await comprador.post('/api/mm/purchase-orders').set(H).send(poBody([{ material_id: ids.arroz, quantity: 1 }], { supplier_id: s.id }))).status).toBe(400);
  });

  it('cancelar rascunho vindo de requisição devolve a requisição para aprovada', async () => {
    const pr = (await comprador.post('/api/mm/purchase-requisitions').set(H).send({ plant_id: ids.cf10, justification: 'C', items: [{ material_id: ids.arroz, quantity: 3, need_date: future() }] })).body.data;
    await gestor.post(`/api/mm/purchase-requisitions/${pr.id}/approve`).set(H);
    const po = (await comprador.post('/api/mm/purchase-orders/from-requisition').set(H).send({ requisition_id: pr.id, supplier_id: ids.f1, purchasing_organization_id: ids.org })).body.data;
    const res = await gestor.post(`/api/mm/purchase-orders/${po.id}/cancel`).set(H).send({ reason: 'Fornecedor errado' });
    expect(res.body.data.status).toBe('CANCELLED');
    expect((await comprador.get(`/api/mm/purchase-requisitions/${pr.id}`)).body.data.status).toBe('APPROVED');
  });
});

describe('cenário 3: recebimento parcial atualiza estoque e pedido', () => {
  let po;
  let m;

  beforeAll(async () => {
    m = await newMaterial({ price: 5 });
    await admin.put(`/api/mm/suppliers/${ids.f1}/materials/${m.id}`).set(H).send({ net_price: 4, lead_time_days: 2 });
    po = (await comprador.post('/api/mm/purchase-orders').set(H).send(poBody([{ material_id: m.id, quantity: 30 }]))).body.data;
    await comprador.post(`/api/mm/purchase-orders/${po.id}/submit`).set(H);
  });

  it('almoxarife recebe 10 de 30: estoque +10, pedido parcialmente recebido, documento 49xxxxxxxx', async () => {
    const before = await balance(m.id);
    const res = await almox.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: po.id, items: [{ purchase_order_item_id: po.items[0].id, quantity: 10 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.doc_number).toMatch(/^49\d{8}$/);
    expect(res.body.data.purchase_order_status).toBe('PARTIALLY_RECEIVED');
    expect(await balance(m.id)).toBe(before + 10);
    const detail = (await comprador.get(`/api/mm/purchase-orders/${po.id}`)).body.data;
    expect(detail.items[0]).toMatchObject({ received_qty: 10, open_qty: 20 });
    expect(detail.receipts).toHaveLength(1);
  });

  it('não recebe acima do pendente sem permissão de excesso', async () => {
    const res = await almox.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: po.id, items: [{ purchase_order_item_id: po.items[0].id, quantity: 21 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/OVERDELIVERY/);
  });

  it('gestor recebe acima do pendente dentro da tolerância do fornecedor (5%) e o pedido fica recebido', async () => {
    const over = await gestor.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: po.id, items: [{ purchase_order_item_id: po.items[0].id, quantity: 23 }] });
    expect(over.status).toBe(400); // pendente 20 + 5% de 30 = 21,5
    const ok = await gestor.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: po.id, items: [{ purchase_order_item_id: po.items[0].id, quantity: 21.5 }] });
    expect(ok.body.data.purchase_order_status).toBe('RECEIVED');
    expect((await almox.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: po.id, items: [{ purchase_order_item_id: po.items[0].id, quantity: 1 }] })).body.error.code).toBe('INVALID_STATUS');
  });

  it('pedido com recebimento não pode ser cancelado', async () => {
    expect((await gestor.post(`/api/mm/purchase-orders/${po.id}/cancel`).set(H).send({ reason: 'Teste' })).status).toBe(409);
  });

  it('rascunho não pode ser recebido', async () => {
    const draft = (await comprador.post('/api/mm/purchase-orders').set(H).send(poBody([{ material_id: m.id, quantity: 1 }]))).body.data;
    expect((await almox.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: draft.id, items: [{ purchase_order_item_id: draft.items[0].id, quantity: 1 }] })).status).toBe(409);
  });
});

describe('estoque: movimentos manuais, inventário e rastreabilidade', () => {
  it('saída maior que o disponível é recusada e não altera nada', async () => {
    const m = await newMaterial({ stock: 5 });
    const res = await admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '201', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sl10a, quantity: 6, reason: 'Consumo interno' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await balance(m.id)).toBe(5);
  });

  it('transferência 311 tira de um depósito e põe no outro, no mesmo documento', async () => {
    const m = await newMaterial({ stock: 10 });
    const res = await admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '311', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sl10a, to_storage_location_id: ids.sl10b, quantity: 4, reason: 'Abastecer a expedição' });
    expect(res.status).toBe(201);
    expect(res.body.data.lines.map((l) => l.quantity)).toEqual([-4, 4]);
    expect(await balance(m.id, ids.sl10a)).toBe(6);
    expect(await balance(m.id, ids.sl10b)).toBe(4);
  });

  it('movimento manual exige justificativa e a permissão MM.STOCK.ADJUST', async () => {
    const m = await newMaterial();
    const body = { movement_type: '561', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sl10a, quantity: 1 };
    expect((await admin.post('/api/mm/stock/movements').set(H).send(body)).status).toBe(400);
    expect((await almox.post('/api/mm/stock/movements').set(H).send({ ...body, reason: 'Sem permissão' })).status).toBe(403);
  });

  it('inventário lança sobra (701) e falta (702) e deixa o saldo igual à contagem', async () => {
    const a = await newMaterial({ stock: 10 });
    const b = await newMaterial({ stock: 10 });
    const res = await gestor.post('/api/mm/inventory').set(H).send({
      plant_id: ids.cf10, storage_location_id: ids.sl10a, reason: 'Inventário rotativo',
      items: [{ material_id: a.id, counted_qty: 12 }, { material_id: b.id, counted_qty: 7 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.doc_number).toMatch(/^01\d{8}$/);
    expect(res.body.data.items.map((i) => i.difference)).toEqual([2, -3]);
    expect(await balance(a.id)).toBe(12);
    expect(await balance(b.id)).toBe(7);
    const doc = (await gestor.get(`/api/mm/material-documents/${res.body.data.material_doc_number}`)).body.data;
    expect(doc.lines.map((l) => l.movement_type).sort()).toEqual(['701', '702']);
  });

  it('cenário 13: todo movimento tem documento, tipo, responsável e data', async () => {
    const [{ n }] = await db('stock_movements').where((q) => q.whereNull('doc_number').orWhereNull('posted_by').orWhereNull('posted_at').orWhereNull('movement_type')).count({ n: '*' });
    expect(Number(n)).toBe(0);
    // O saldo de cada depósito é exatamente a soma dos seus movimentos.
    const diff = await db.raw(`
      SELECT COUNT(*) AS n FROM stock_balances b
      WHERE b.physical_qty <> (SELECT COALESCE(SUM(mv.quantity), 0) FROM stock_movements mv
                               WHERE mv.material_id = b.material_id AND mv.storage_location_id = b.storage_location_id)`);
    expect(Number(diff[0][0].n)).toBe(0);
  });
});

describe('concorrência: saídas simultâneas nunca deixam o estoque negativo', () => {
  it('10 saídas de 3 un. em paralelo sobre 20 un.: 6 aprovadas, 4 recusadas, saldo 2', async () => {
    const m = await newMaterial({ stock: 20 });
    const send = () => admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '201', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sl10a, quantity: 3, reason: 'Consumo concorrente' });
    const results = await Promise.all(Array.from({ length: 10 }, send));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(6);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    expect(await balance(m.id)).toBe(2);
    const exits = await db('stock_movements').where({ material_id: m.id, movement_type: '201' }).count({ n: '*' });
    expect(Number(exits[0].n)).toBe(6);
  });

  it('números de documento nunca se repetem sob concorrência', async () => {
    const m = await newMaterial();
    const send = () => admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '561', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sl10a, quantity: 1, reason: 'Entrada concorrente' });
    const docs = (await Promise.all(Array.from({ length: 8 }, send))).map((r) => r.body.data.doc_number);
    expect(new Set(docs).size).toBe(8);
  });
});

describe('MRP simplificado', () => {
  it('sugere repor até o máximo e, depois de converter, não sugere de novo (requisição aberta cobre)', async () => {
    const m = await newMaterial({ rop: 50, max: 100, stock: 10 });
    const run = await analista.post('/api/mm/mrp/run').set(H).send({ plant_id: ids.cf10 });
    expect(run.status).toBe(200);
    const s = run.body.data.find((x) => x.material_id === m.id);
    expect(s).toMatchObject({ available_qty: 10, coverage_qty: 10, suggested_qty: 90, plant_code: 'CF10' });

    const conv = await analista.post('/api/mm/mrp/convert').set(H).send({ items: [{ material_id: m.id, plant_id: ids.cf10, quantity: s.suggested_qty }] });
    expect(conv.status).toBe(201);
    const pr = (await analista.get(`/api/mm/purchase-requisitions/${conv.body.data[0].id}`)).body.data;
    expect(pr).toMatchObject({ source: 'MRP', status: 'PENDING_APPROVAL' });
    expect(pr.items[0].quantity).toBe(90);

    const again = (await analista.post('/api/mm/mrp/run').set(H).send({ plant_id: ids.cf10 })).body.data;
    expect(again.find((x) => x.material_id === m.id)).toBeUndefined();
  });

  it('material acima do ponto de reposição não gera sugestão', async () => {
    const m = await newMaterial({ rop: 5, max: 10, stock: 8 });
    const run = (await analista.post('/api/mm/mrp/run').set(H).send({ plant_id: ids.cf10 })).body.data;
    expect(run.find((x) => x.material_id === m.id)).toBeUndefined();
  });

  it('comprador não roda o MRP', async () => {
    expect((await comprador.post('/api/mm/mrp/run').set(H).send({})).status).toBe(403);
  });
});

describe('cenários 11 e 12: permissões e escopo nas rotas reais de MM', () => {
  it('vendedor não cria pedido nem requisição de compra', async () => {
    expect((await vendedor.post('/api/mm/purchase-orders').set(H).send(poBody([{ material_id: ids.arroz, quantity: 1 }]))).status).toBe(403);
    expect((await vendedor.post('/api/mm/purchase-requisitions').set(H).send({})).status).toBe(403);
  });

  it('almoxarife não altera cadastro de material nem de fornecedor', async () => {
    expect((await almox.put(`/api/mm/materials/${ids.arroz}`).set(H).send({})).status).toBe(403);
    expect((await almox.put(`/api/mm/suppliers/${ids.f1}`).set(H).send({})).status).toBe(403);
  });

  it('usuário do CF10 não cria requisição no CF20 nem vê documentos do CF20', async () => {
    const res = await comprador.post('/api/mm/purchase-requisitions').set(H).send({ plant_id: ids.cf20, justification: 'Outro centro', items: [{ material_id: ids.arroz, quantity: 1, need_date: future() }] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUT_OF_SCOPE');

    const po20 = (await admin.post('/api/mm/purchase-orders').set(H).send(poBody([{ material_id: ids.arroz, quantity: 1 }], { plant_id: ids.cf20 }))).body.data;
    expect((await comprador.get(`/api/mm/purchase-orders/${po20.id}`)).status).toBe(403);
    const list = (await comprador.get('/api/mm/purchase-orders?pageSize=100')).body.data;
    expect(list.every((p) => p.plant_code === 'CF10')).toBe(true);
    const stock = (await comprador.get('/api/mm/stock?pageSize=100')).body.data;
    expect(stock.every((s) => s.plant_code === 'CF10')).toBe(true);
  });

  it('dados do material no CF20 não aparecem para quem só tem o CF10', async () => {
    const res = (await comprador.get(`/api/mm/materials/${ids.arroz}`)).body.data;
    expect(res.plants.map((p) => p.plant_code)).toEqual(['CF10']);
    expect((await comprador.put(`/api/mm/materials/${ids.arroz}/plants/${ids.cf20}`).set(H).send({ min_stock: 0, reorder_point: 0, max_stock: 0 })).status).toBe(403);
  });
});
