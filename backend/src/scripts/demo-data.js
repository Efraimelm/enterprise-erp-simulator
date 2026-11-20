// Histórico de demonstração: cerca de 6 meses de compras, recebimentos, vendas, faturas e pagamentos.
//
// Por quê: depois do seed, o banco só tem cadastros e estoque inicial, então os relatórios de vendas,
// contas a receber e o Power BI aparecem vazios. Este script gera um histórico plausível.
//
// Como funciona (honesto e rastreável):
//   1. Todos os documentos são criados PELA API, com as mesmas regras, validações, numeração e auditoria
//      de um usuário real. O responsável é o usuário "carga_demo", que é desativado no final.
//   2. Depois, as DATAS dos documentos são movidas para o passado (histórico simulado). Só datas mudam:
//      quantidades, valores e saldos continuam os calculados pelo ERP.
//
// Uso: npm run demo:data   (uma vez; se já rodou, não faz nada).  Nunca roda com NODE_ENV=production.
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { hashPassword } from '../lib/password.js';

const H = { 'X-ERP-Client': 'web' };
const DAYS = 180;
const LOADER = 'carga_demo';

// Gerador pseudoaleatório com semente fixa: a mesma carga gera sempre o mesmo histórico.
let seed = 20261119;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const todayDate = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z');
const day = (offset) => new Date(todayDate.getTime() + offset * 86400_000).toISOString().slice(0, 10);
const at = (offset, hour = 10) => new Date(`${day(offset)}T${String(hour).padStart(2, '0')}:00:00`);

function ok(res, what) {
  if (res.status >= 300) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.body?.error ?? res.body)}`);
  return res.body.data;
}

async function main() {
  if (config.isProduction) throw new Error('A carga de demonstração não roda em produção.');
  if (await db('users').where({ username: LOADER }).first('id')) {
    console.log('O histórico de demonstração já foi carregado (usuário carga_demo existe). Nada a fazer.');
    return;
  }

  // Usuário da carga: senha aleatória que ninguém conhece, desativado no final.
  const password = `Dm-${crypto.randomBytes(12).toString('base64url')}9a`;
  const [loaderId] = await db('users').insert({
    username: LOADER, full_name: 'Carga de demonstração (histórico simulado)', password_hash: await hashPassword(password), must_change_password: false,
  });
  await db('user_roles').insert({ user_id: loaderId, role_id: (await db('roles').where({ code: 'SAP_ADMIN' }).first('id')).id });
  await db('user_org_scopes').insert({ user_id: loaderId, scope_type: 'ALL' });

  const api = request.agent(createApp({ loginRateLimit: 10_000 }));
  ok(await api.post('/api/auth/login').set(H).send({ username: LOADER, password }), 'login');

  // Histórico não dispara webhooks: as assinaturas ficam pausadas durante a carga, e os eventos gerados
  // são marcados como já despachados (continuam registrados na tela de Integrações).
  const activeSubs = await db('webhook_subscriptions').where({ is_active: true }).pluck('id');
  const lastEvent = (await db('integration_events').max({ id: 'id' }).first()).id ?? 0;
  if (activeSubs.length) await db('webhook_subscriptions').whereIn('id', activeSubs).update({ is_active: false });
  try {
    await load(api);
  } finally {
    await db('integration_events').where('id', '>', lastEvent).whereNull('dispatched_at').update({ dispatched_at: new Date() });
    if (activeSubs.length) await db('webhook_subscriptions').whereIn('id', activeSubs).update({ is_active: true });
    await db('sessions').where({ user_id: loaderId }).del();
    await db('user_roles').where({ user_id: loaderId }).del();
    await db('user_org_scopes').where({ user_id: loaderId }).del();
    await db('users').where({ id: loaderId }).update({ status: 'INACTIVE', password_hash: await hashPassword(crypto.randomBytes(24).toString('hex')) });
  }
}

async function load(api) {
  const id = async (table, code) => (await db(table).where({ code }).first('id')).id;
  const plants = { CF10: await id('plants', 'CF10'), CF20: await id('plants', 'CF20') };
  const porg = await id('purchasing_organizations', 'CF10');
  const sorg = await id('sales_organizations', 'CF10');
  const channel = { 10: await id('distribution_channels', '10'), 20: await id('distribution_channels', '20') };
  const division = await id('divisions', '01');
  const materials = await db('materials').whereIn('material_type', ['HAWA']).select('id', 'code', 'category', 'reference_price');
  const supplierFor = { Alimentos: await id('suppliers', 'F0001'), Bebidas: await id('suppliers', 'F0002') };
  const fallbackSupplier = await id('suppliers', 'F0003');
  const customers = { C0001: await id('customers', 'C0001'), C0002: await id('customers', 'C0002'), C0003: await id('customers', 'C0003') };
  const channelsOf = { C0001: [10, 20], C0002: [20], C0003: [10] };

  // O estoque inicial do seed passa a ser o saldo de abertura, antes do início do histórico.
  await db('stock_movements').where({ movement_type: '561' }).update({ posted_at: at(-DAYS - 5, 8) });

  // Agenda: compras a cada ~2 semanas e vendas a cada ~4 dias, processadas em ordem cronológica.
  const events = [];
  for (let d = -DAYS; d <= -3; d += between(12, 16)) events.push({ type: 'po', d });
  for (let d = -DAYS + 4; d <= -1; d += between(3, 5)) events.push({ type: 'so', d });
  events.sort((a, b) => a.d - b.d || (a.type === 'po' ? -1 : 1));

  const available = async (materialId, plantId) => Number((await db('stock_balances').where({ material_id: materialId, plant_id: plantId }).sum({ q: db.raw('physical_qty - reserved_qty') }).first()).q ?? 0);
  const stats = { po: 0, gr: 0, so: 0, billed: 0, open: 0, paid: 0 };

  for (const ev of events) {
    if (ev.type === 'po') {
      // Pedido de compra abaixo do limite de aprovação (R$ 1.000), recebido entre 4 e 10 dias depois.
      const plantCode = rnd() < 0.7 ? 'CF10' : 'CF20';
      const m = pick(materials);
      const price = Number(m.reference_price);
      const quantity = Math.max(10, Math.min(between(40, 160), Math.floor(950 / price)));
      const delivery = ev.d + 7;
      const po = ok(await api.post('/api/mm/purchase-orders').set(H).send({
        supplier_id: supplierFor[m.category] ?? fallbackSupplier, purchasing_organization_id: porg, plant_id: plants[plantCode],
        delivery_date: day(delivery), items: [{ material_id: m.id, quantity, unit_price: price }],
      }), 'pedido de compra');
      ok(await api.post(`/api/mm/purchase-orders/${po.id}/submit`).set(H), 'enviar pedido');
      await db('purchase_orders').where({ id: po.id }).update({ created_at: at(ev.d, 9), submitted_at: at(ev.d, 10) });
      stats.po++;

      const receiveDay = ev.d + between(4, 10); // às vezes depois do prazo (pontualidade < 100%)
      if (receiveDay >= 0) continue; // ainda não chegou: fica pendente
      const partial = rnd() < 0.15;
      ok(await api.post('/api/mm/goods-receipts').set(H).send({
        purchase_order_id: po.id, items: [{ purchase_order_item_id: po.items[0].id, quantity: partial ? Math.ceil(quantity / 2) : quantity }],
      }), 'recebimento');
      const gr = await db('goods_receipts').where({ purchase_order_id: po.id }).orderBy('id', 'desc').first('id', 'doc_number');
      await db('goods_receipts').where({ id: gr.id }).update({ posted_at: at(receiveDay, 14) });
      await db('stock_movements').where({ doc_number: gr.doc_number }).update({ posted_at: at(receiveDay, 14) });
      stats.gr++;
      continue;
    }

    // Venda: cliente, canal, centro e de 1 a 2 materiais com estoque disponível.
    const customerCode = pick(['C0001', 'C0001', 'C0002', 'C0003', 'C0003']);
    const ch = pick(channelsOf[customerCode]);
    const plantCode = rnd() < 0.75 ? 'CF10' : 'CF20';
    const items = [];
    for (const m of [pick(materials), pick(materials)]) {
      if (items.some((i) => i.material_id === m.id)) continue;
      const free = await available(m.id, plants[plantCode]);
      const qty = Math.min(between(4, 24), Math.floor(free / 3), Math.floor(1800 / Number(m.reference_price) / 2));
      if (qty >= 1) items.push({ material_id: m.id, quantity: qty });
    }
    if (!items.length) continue;

    const so = ok(await api.post('/api/sd/sales-orders').set(H).send({
      customer_id: customers[customerCode], sales_organization_id: sorg, distribution_channel_id: channel[ch], division_id: division,
      plant_id: plants[plantCode], requested_date: day(ev.d + 3), items,
    }), 'pedido de venda');
    const confirmed = ok(await api.post(`/api/sd/sales-orders/${so.id}/submit`).set(H), 'confirmar pedido de venda');
    await db('sales_orders').where({ id: so.id }).update({ created_at: at(ev.d, 11) });
    stats.so++;

    // Os pedidos dos últimos dias ficam em aberto (alguns já atrasados), como numa operação real.
    if (ev.d > -6 || confirmed.status !== 'CONFIRMED') { stats.open++; continue; }

    const shipDay = ev.d + 1;
    const delivery = ok(await api.post('/api/sd/deliveries').set(H).send({
      sales_order_id: so.id, items: confirmed.items.map((i) => ({ sales_order_item_id: i.id, quantity: Number(i.quantity) })),
    }), 'entrega');
    ok(await api.post(`/api/sd/deliveries/${delivery.id}/pick`).set(H).send({
      items: delivery.items.map((i) => ({ delivery_item_id: i.id, picked_qty: Number(i.quantity) })),
    }), 'separação');
    ok(await api.post(`/api/sd/deliveries/${delivery.id}/post-goods-issue`).set(H), 'saída de mercadoria');
    const d = await db('deliveries').where({ id: delivery.id }).first('material_doc_number');
    await db('deliveries').where({ id: delivery.id }).update({ created_at: at(shipDay, 8), picked_at: at(shipDay, 9), posted_at: at(shipDay, 10) });
    await db('stock_movements').where({ doc_number: d.material_doc_number }).update({ posted_at: at(shipDay, 10) });

    const bill = ok(await api.post('/api/sd/billing').set(H).send({ delivery_id: delivery.id, billing_date: day(shipDay) }), 'faturamento');
    stats.billed++;

    // Pagamentos: a maioria paga perto do vencimento; uma parte paga só metade e outra fica vencida.
    const r = await db('accounts_receivable').where({ billing_document_id: bill.id }).first('id', 'amount', 'due_date');
    if (!r) continue;
    const dueOffset = Math.round((new Date(`${r.due_date}T12:00:00Z`) - todayDate) / 86400_000);
    const payDay = dueOffset + between(-5, 6);
    const roll = rnd();
    if (payDay >= 0 || roll < 0.12) continue; // ainda não pago (a vencer ou vencido)
    const amount = roll < 0.22 ? Math.round(Number(r.amount) * 50) / 100 : Number(r.amount);
    ok(await api.post(`/api/sd/receivables/${r.id}/payments`).set(H).send({ amount, payment_date: day(Math.max(payDay, shipDay)), method: pick(['PIX', 'BOLETO', 'TRANSFER']), notes: 'Histórico de demonstração' }), 'pagamento');
    stats.paid++;
  }

  console.log(`Histórico de demonstração carregado (${DAYS} dias):`);
  console.log(`  ${stats.po} pedidos de compra, ${stats.gr} recebimentos`);
  console.log(`  ${stats.so} pedidos de venda, ${stats.billed} faturados, ${stats.open} em aberto, ${stats.paid} pagamentos`);
}

main()
  .catch((e) => { console.error('Falha na carga de demonstração:', e.message); process.exitCode = 1; })
  .finally(() => db.destroy());
