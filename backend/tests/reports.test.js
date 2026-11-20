// Etapa 7 - Relatórios de BI: valores conferidos à mão com dados controlados em um centro isolado.
import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { app, CLIENT_HEADER, createUser, idByCode, loginAs } from './helpers.js';

const H = CLIENT_HEADER;
const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const code = (p, n = 4) => `${p}${crypto.randomBytes(2).toString('hex').toUpperCase()}`.slice(0, n);

let admin; let P; let sloc; let A; let B; let docs;
const get = (name, qs = '', agent = admin) => agent.get(`/api/reports/${name}?plant_id=${P}${qs}`);

beforeAll(async () => {
  admin = await loginAs(await createUser({ roles: ['SAP_ADMIN'] }));
  const cf01 = await idByCode('companies', 'CF01');
  P = (await admin.post('/api/org/plants').set(H).send({ code: code('R'), name: 'Centro de relatórios', company_id: cf01 })).body.data.id;
  sloc = (await admin.post('/api/org/storage-locations').set(H).send({ plant_id: P, code: '0001', name: 'Depósito' })).body.data.id;
  const porg = await idByCode('purchasing_organizations', 'CF10');
  await admin.post('/api/org/purchasing-org-plants').set(H).send({ purchasing_organization_id: porg, plant_id: P });
  const sorg = await idByCode('sales_organizations', 'CF10');

  const mat = async (category, ref, price) => {
    const m = (await admin.post('/api/mm/materials').set(H).send({ code: code('BI-', 8), description: `Produto ${category}`, material_type: 'HAWA', category, base_unit: 'UN', reference_price: ref })).body.data;
    await admin.put(`/api/mm/materials/${m.id}/plants/${P}`).set(H).send({ default_storage_location_id: sloc, min_stock: 0, reorder_point: 70, max_stock: 200 });
    await admin.post('/api/sd/prices').set(H).send({ material_id: m.id, sales_organization_id: sorg, price, valid_from: day(-400), valid_to: day(400) });
    return m;
  };
  A = await mat(`Cat-A-${code('', 3)}`, 10, 30);
  B = await mat(`Cat-B-${code('', 3)}`, 20, 50);

  // Estoque inicial de A há 10 dias (antes do período do giro).
  const load = (await admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '561', material_id: A.id, plant_id: P, storage_location_id: sloc, quantity: 100, reason: 'Carga inicial (teste de BI)' })).body.data;
  await db('stock_movements').where({ doc_number: load.doc_number }).update({ posted_at: new Date(Date.now() - 10 * 86400_000) });

  // Compras: PC1 de B (10 × 20 = 200) recebido no prazo; PC2 de A (5 × 10 = 50) com entrega ontem, só 2 recebidos.
  const f1 = await idByCode('suppliers', 'F0001');
  const po = async (material, quantity, delivery) => {
    const o = (await admin.post('/api/mm/purchase-orders').set(H).send({ supplier_id: f1, purchasing_organization_id: porg, plant_id: P, delivery_date: delivery, items: [{ material_id: material.id, quantity, unit_price: material.reference_price }] })).body.data;
    await admin.post(`/api/mm/purchase-orders/${o.id}/submit`).set(H);
    return o;
  };
  const po1 = await po(B, 10, day(5));
  await admin.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: po1.id, items: [{ purchase_order_item_id: po1.items[0].id, quantity: 10 }] });
  const po2 = await po(A, 5, day(-1));
  await admin.post('/api/mm/goods-receipts').set(H).send({ purchase_order_id: po2.id, items: [{ purchase_order_item_id: po2.items[0].id, quantity: 2 }] });

  // Vendas (canal 10, setor 01, imposto padrão 18%).
  const base = { customer_id: await idByCode('customers', 'C0001'), sales_organization_id: sorg, distribution_channel_id: await idByCode('distribution_channels', '10'), division_id: await idByCode('divisions', '01'), plant_id: P, requested_date: day(-2) };
  const sell = async (material, quantity, { deliver = true, billDate } = {}) => {
    const so = (await admin.post('/api/sd/sales-orders').set(H).send({ ...base, items: [{ material_id: material.id, quantity }] })).body.data;
    const c = (await admin.post(`/api/sd/sales-orders/${so.id}/submit`).set(H)).body.data;
    if (!deliver) return { so: c };
    const d = (await admin.post('/api/sd/deliveries').set(H).send({ sales_order_id: so.id, items: [{ sales_order_item_id: c.items[0].id, quantity }] })).body.data;
    await admin.post(`/api/sd/deliveries/${d.id}/pick`).set(H).send({ items: [{ delivery_item_id: d.items[0].id, picked_qty: quantity }] });
    await admin.post(`/api/sd/deliveries/${d.id}/post-goods-issue`).set(H);
    const bill = (await admin.post('/api/sd/billing').set(H).send({ delivery_id: d.id, ...(billDate ? { billing_date: billDate } : {}) })).body.data;
    return { so: c, bill };
  };
  const s1 = await sell(A, 40); // 40 × 30 = 1.200 + 216 = 1.416, vence em 30 dias
  const s2 = await sell(B, 3); // faturada e depois estornada: sai das vendas
  await admin.post(`/api/sd/billing/${s2.bill.id}/cancel`).set(H).send({ reason: 'Teste de estorno no BI' });
  const s3 = await sell(B, 2, { deliver: false }); // aberto: 2 × 50 × 1,18 = 118
  const s4 = await sell(A, 1, { billDate: day(-45) }); // 30 + 5,40 = 35,40, venceu há 15 dias
  const s5 = await sell(B, 1, { billDate: day(-45) }); // outra categoria no mesmo dia: 50 + 9 = 59, venceu há 15 dias
  docs = { po1, po2, s1, s3, s4, s5 };
});
afterAll(() => db.destroy());

describe('estoque', () => {
  it('posição de estoque: físico, reservado, disponível e valor pelo preço de referência', async () => {
    const res = await get('stock-position');
    const a = res.body.data.find((r) => r.material === A.code);
    const b = res.body.data.find((r) => r.material === B.code);
    expect(a).toMatchObject({ fisico: 61, reservado: 0, disponivel: 61, valor: 610, abaixo_do_ponto: true }); // 100 + 2 − 40 − 1
    expect(b).toMatchObject({ fisico: 6, reservado: 2, disponivel: 4, valor: 120, abaixo_do_ponto: true }); // 10 − 3 − 1, 2 reservados
    expect(res.body.totals.valor).toBe(730);
    expect(res.body.meta.definition).toMatch(/preço de referência/);
  });

  it('giro e cobertura no período (5 dias atrás até hoje)', async () => {
    const res = await get('stock-turnover', `&from=${day(-5)}&to=${day(0)}`);
    const a = res.body.data.find((r) => r.material === A.code);
    // inicial 100 (carga há 10 dias), entradas 2 (101), saídas 41 (601), final 61, médio 80,5
    expect(a).toMatchObject({ estoque_inicial: 100, entradas: 2, saidas: 41, estoque_final: 61, estoque_medio: 80.5 });
    expect(a.giro).toBeCloseTo(41 / 80.5, 2);
    expect(a.cobertura_dias).toBeCloseTo(61 / (41 / 6), 1);
    expect(res.body.totals.dias_do_periodo).toBe(6);
  });
});

describe('compras', () => {
  it('compras por fornecedor: valor, recebido e pontualidade', async () => {
    const res = await get('purchases-by-supplier', `&from=${day(-1)}&to=${day(0)}`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ pedidos: 2, valor_bruto: 250, valor_recebido: 220, percentual_recebido: 88, pedidos_recebidos: 1, no_prazo: 1, pontualidade: 100 });
  });

  it('pedidos pendentes: valor pendente e atraso', async () => {
    const res = await get('open-purchase-orders');
    expect(res.body.data).toEqual([expect.objectContaining({ pedido: docs.po2.number, valor_pendente: 30, dias_de_atraso: 1, atrasado: true })]);
  });
});

describe('vendas e financeiro', () => {
  it('vendas por mês e categoria: só faturas ativas (estornada fica de fora)', async () => {
    const res = await get('sales-by-period', `&from=${day(-60)}&to=${day(0)}&group=month`);
    const ofA = res.body.data.filter((r) => r.categoria === A.category);
    expect(ofA.reduce((s, r) => s + r.liquido, 0)).toBeCloseTo(1230, 2); // 1.200 + 30
    // B: só a venda de 1 unidade (a de 3 foi estornada). Fica numa linha própria no mesmo mês da venda de A.
    const ofB = res.body.data.filter((r) => r.categoria === B.category);
    expect(ofB).toEqual([expect.objectContaining({ periodo: day(-45).slice(0, 7), liquido: 50, faturas: 1 })]);
    expect(ofA.find((r) => r.periodo === day(-45).slice(0, 7))).toMatchObject({ liquido: 30, faturas: 1 });
    expect(res.body.totals.por_categoria[B.category]).toBe(50);
    const month = day(0).slice(0, 7);
    expect(ofA.find((r) => r.periodo === month)).toMatchObject({ liquido: 1200, imposto: 216, bruto: 1416, quantidade: 40, faturas: 1 });
    expect(res.body.totals.por_categoria[A.category]).toBe(1230);
  });

  it('agrupamento por dia', async () => {
    const res = await get('sales-by-period', `&from=${day(-60)}&to=${day(0)}&group=day`);
    const sameDay = res.body.data.filter((r) => r.periodo === day(-45));
    expect(sameDay.find((r) => r.categoria === A.category)).toMatchObject({ liquido: 30, bruto: 35.4 });
    expect(sameDay.find((r) => r.categoria === B.category)).toMatchObject({ liquido: 50, bruto: 59 });
  });

  it('pedidos de venda em aberto: pendente, valor com imposto e atraso', async () => {
    const res = await get('open-sales-orders');
    expect(res.body.data).toEqual([expect.objectContaining({ pedido: docs.s3.so.number, quantidade_pendente: 2, valor_pendente: 118, dias_de_atraso: 2 })]);
  });

  it('contas a receber por faixa de vencimento', async () => {
    const res = await get('receivables-aging');
    expect(res.body.data).toEqual([expect.objectContaining({ titulos: 3, a_vencer: 1416, d1_30: 94.4, d31_60: 0, total: 1510.4 })]);
    expect(res.body.totals).toMatchObject({ titulos: 3, a_vencer: 1416, d1_30: 94.4, total: 1510.4 });
  });
});

describe('exportação, Power BI e segurança', () => {
  it('CSV para o Excel: BOM, separador ";" e decimal com vírgula', async () => {
    const res = await get('stock-position', '&format=csv');
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="stock-position-/);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const [header, ...lines] = res.text.slice(1).trim().split('\r\n');
    expect(header.split(';').slice(0, 3)).toEqual(['Material', 'Descrição', 'Categoria']);
    expect(lines.find((l) => l.startsWith(A.code))).toContain(';610,00;');
    const dot = await get('stock-position', '&format=csv&decimal=dot');
    expect(dot.text).toContain(';610.00;');
  });

  it('all=true devolve todas as linhas; paginação normal respeita pageSize', async () => {
    expect((await get('stock-position', '&all=true')).body.data.length).toBe(2);
    const paged = await get('stock-position', '&pageSize=1&page=2');
    expect(paged.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(paged.body.data).toHaveLength(1);
  });

  it('chave de integração lê o relatório completo (Power BI)', async () => {
    const client = (await admin.post('/api/integration/clients').set(H).send({ name: 'Power BI teste', roles: ['INTEGRATION_READONLY'], scopes: [{ type: 'ALL' }] })).body.data;
    const res = await request(app).get(`/api/reports/sales-by-period?plant_id=${P}&all=true&from=${day(-60)}&to=${day(0)}`).set({ Authorization: `Bearer ${client.apiKey}` });
    expect(res.status).toBe(200);
    expect(res.body.meta.definition).toMatch(/Faturas ativas/);
  });

  it('permissão por relatório e escopo do centro', async () => {
    const vendedor = await loginAs(await createUser({ roles: ['SALES'], scopes: [{ type: 'PLANT', plant_id: P }] }));
    const names = (await vendedor.get('/api/reports')).body.data.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['stock-position', 'open-sales-orders']));
    expect(names).not.toContain('purchases-by-supplier');
    expect((await get('purchases-by-supplier', '', vendedor)).status).toBe(403);
    const cf10 = await loginAs(await createUser({ roles: ['SAP_ADMIN'], scopes: [{ type: 'PLANT', plant_id: await idByCode('plants', 'CF10') }] }));
    const res = await get('stock-position', '', cf10);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUT_OF_SCOPE');
    // Sem filtro de centro, o usuário do CF10 não vê o centro de relatórios.
    const mine = (await cf10.get('/api/reports/stock-position?all=true')).body.data;
    expect(mine.some((r) => r.material === A.code)).toBe(false);
  });

  it('valida o período', async () => {
    expect((await get('stock-turnover', `&from=${day(0)}&to=${day(-1)}`)).status).toBe(400);
    expect((await get('stock-turnover', `&from=${day(-400)}&to=${day(0)}`)).status).toBe(400);
    expect((await admin.get('/api/reports/nao-existe')).status).toBe(404);
  });
});
