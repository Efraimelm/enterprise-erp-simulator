// Etapa 6 - API de integração (chave), idempotência, eventos e webhooks (cenário 14),
// OpenAPI e assistente de IA (cenário 15).
import crypto from 'node:crypto';
import http from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { db } from '../src/db.js';
import { signWebhook } from '../src/lib/crypto.js';
import { dispatchPending, RETRY_MINUTES } from '../src/lib/webhooks.js';
import { app, CLIENT_HEADER, createUser, idByCode, loginAs } from './helpers.js';

const H = CLIENT_HEADER;
const plus = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

/* Receptor HTTP local que faz o papel do n8n. */
const received = [];
let receiverStatus = 200;
let receiver;
let receiverUrl;

let ids; let admin; let vendedor; let comprador;

beforeAll(async () => {
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ headers: req.headers, body, url: req.url });
      res.writeHead(receiverStatus, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${receiver.address().port}/webhook/erp-eventos`;

  ids = { cf10: await idByCode('plants', 'CF10'), cf20: await idByCode('plants', 'CF20') };
  ids.sla = (await db('storage_locations').where({ plant_id: ids.cf10, code: '0001' }).first('id')).id;
  admin = await loginAs(await createUser({ roles: ['SAP_ADMIN'] }));
  vendedor = await loginAs(await createUser({ roles: ['SALES'], scopes: [{ type: 'PLANT', plant_id: ids.cf10 }] }));
  comprador = await loginAs(await createUser({ roles: ['PROCUREMENT'], scopes: [{ type: 'PLANT', plant_id: ids.cf10 }] }));
});
afterAll(async () => {
  await new Promise((r) => receiver.close(r));
  await db.destroy();
});

async function newClient(roles = ['INTEGRATION_READONLY'], scopes = [{ type: 'PLANT', plant_id: ids.cf10 }]) {
  const res = await admin.post('/api/integration/clients').set(H).send({ name: `n8n teste ${crypto.randomBytes(2).toString('hex')}`, roles, scopes });
  expect(res.status).toBe(201);
  return res.body.data;
}
const bearer = (key) => ({ Authorization: `Bearer ${key}` });

describe('chave de API (cliente de integração)', () => {
  let client;
  beforeAll(async () => { client = await newClient(); });

  it('a chave aparece uma vez e o banco guarda só o hash', async () => {
    expect(client.apiKey).toMatch(/^erp_[A-Za-z0-9]{8}_/);
    const row = await db('api_keys').where({ id: client.key_id }).first();
    expect(row.key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.key_hash).not.toContain(client.apiKey);
    const list = (await admin.get('/api/integration/clients')).body.data.find((c) => c.id === client.user_id);
    expect(JSON.stringify(list)).not.toContain(client.apiKey);
  });

  it('lê dados com as roles e o escopo do cliente (só CF10)', async () => {
    const res = await request(app).get('/api/mm/stock?pageSize=100').set(bearer(client.apiKey));
    expect(res.status).toBe(200);
    expect(res.body.data.every((s) => s.plant_code === 'CF10')).toBe(true);
    const kpis = await request(app).get('/api/kpis/summary').set(bearer(client.apiKey));
    expect(kpis.status).toBe(200);
    expect(kpis.body.data).toMatchObject({ estoque: expect.any(Object), compras: expect.any(Object), vendas: expect.any(Object), financeiro: expect.any(Object) });
    expect(kpis.body.data.definitions['financeiro.titulos_atrasados']).toMatch(/due_date/);
  });

  it('é somente leitura: POST com chave → 403 READ_ONLY_KEY (sem precisar do cabeçalho CSRF)', async () => {
    const res = await request(app).post('/api/mm/purchase-requisitions').set(bearer(client.apiKey)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('READ_ONLY_KEY');
  });

  it('não acessa o que a role não permite (administração de usuários)', async () => {
    expect((await request(app).get('/api/admin/users').set(bearer(client.apiKey))).status).toBe(403);
  });

  it('chamadas por chave ficam no log de integração', async () => {
    const logs = await db('integration_logs').where({ direction: 'IN', api_key_id: client.key_id });
    expect(logs.length).toBeGreaterThanOrEqual(3);
    expect(logs.every((l) => l.target.startsWith('/api/'))).toBe(true);
  });

  it('usuário técnico não entra pela tela de login', async () => {
    const res = await request(app).post('/api/auth/login').set(H).send({ username: client.username, password: 'qualquer-coisa-123' });
    expect(res.status).toBe(401);
  });

  it('chave inexistente ou revogada → 401', async () => {
    expect((await request(app).get('/api/mm/stock').set(bearer('erp_AAAAAAAA_naoexisteeeeeeeeeeeeeeeeeeeee'))).status).toBe(401);
    const other = await newClient();
    expect((await admin.post(`/api/integration/keys/${other.key_id}/revoke`).set(H)).status).toBe(204);
    const res = await request(app).get('/api/mm/stock').set(bearer(other.apiKey));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
  });

  it('limite de chamadas por chave → 429', async () => {
    const limited = createApp({ apiKeyRateLimit: 2 });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await request(limited).get('/api/kpis/summary').set(bearer(client.apiKey))).status);
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('vendedor não administra integrações', async () => {
    expect((await vendedor.get('/api/integration/clients')).status).toBe(403);
    expect((await vendedor.post('/api/integration/webhooks').set(H).send({})).status).toBe(403);
  });
});

describe('idempotência', () => {
  it('repetir um POST com a mesma Idempotency-Key devolve a resposta original e não duplica', async () => {
    const m = (await admin.post('/api/mm/materials').set(H).send({ code: `ID-${crypto.randomBytes(3).toString('hex')}`, description: 'Idempotência', material_type: 'HAWA', base_unit: 'UN', reference_price: 1 })).body.data;
    await admin.put(`/api/mm/materials/${m.id}/plants/${ids.cf10}`).set(H).send({ default_storage_location_id: ids.sla, min_stock: 0, reorder_point: 0, max_stock: 0 });
    const body = { movement_type: '561', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sla, quantity: 7, reason: 'Carga com idempotência' };
    const key = `teste-${crypto.randomUUID()}`;
    const first = await admin.post('/api/mm/stock/movements').set(H).set('Idempotency-Key', key).send(body);
    const second = await admin.post('/api/mm/stock/movements').set(H).set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.data.doc_number).toBe(first.body.data.doc_number);
    expect(Number((await db('stock_movements').where({ material_id: m.id }).count({ n: '*' }))[0].n)).toBe(1);
    const conflict = await admin.post('/api/mm/stock/movements').set(H).set('Idempotency-Key', key).send({ ...body, quantity: 8 });
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('chave mal formada → 400', async () => {
    expect((await admin.post('/api/mm/stock/movements').set(H).set('Idempotency-Key', 'x').send({})).status).toBe(400);
  });
});

describe('cenário 14: eventos e webhooks (receptor no lugar do n8n)', () => {
  let sub;

  beforeAll(async () => {
    // Isola este bloco: desliga assinaturas antigas e marca como despachados os eventos gerados
    // pelos outros arquivos de teste (senão a assinatura nova receberia centenas de eventos antigos).
    await db('webhook_subscriptions').update({ is_active: false });
    await db('integration_events').whereNull('dispatched_at').update({ dispatched_at: new Date() });
    const res = await admin.post('/api/integration/webhooks').set(H).send({ name: 'n8n local (teste)', url: receiverUrl, events: ['*'] });
    expect(res.status).toBe(201);
    sub = res.body.data;
    received.length = 0;
  });

  it('o segredo aparece uma vez e fica cifrado no banco', async () => {
    expect(sub.secret).toHaveLength(43);
    const row = await db('webhook_subscriptions').where({ id: sub.id }).first();
    expect(row.secret_encrypted).toMatch(/^v1\./);
    expect(row.secret_encrypted).not.toContain(sub.secret);
  });

  it('criar uma requisição gera o evento na mesma transação e o receptor recebe o POST assinado', async () => {
    const arroz = await idByCode('materials', 'ALM-0001');
    const pr = (await comprador.post('/api/mm/purchase-requisitions').set(H).send({ plant_id: ids.cf10, justification: 'Teste de webhook', items: [{ material_id: arroz, quantity: 5, need_date: plus(3) }] })).body.data;
    const r = await dispatchPending();
    expect(r.failed).toBe(0);
    const hit = received.find((x) => JSON.parse(x.body).data?.number === pr.number);
    expect(hit).toBeTruthy();
    const env = JSON.parse(hit.body);
    expect(env).toMatchObject({ type: 'purchase_requisition.created', source: 'enterprise-erp-simulator', id: expect.any(String) });
    expect(hit.headers['x-erp-event']).toBe('purchase_requisition.created');
    expect(hit.headers['x-erp-event-id']).toBe(env.id);
    // O receptor confere a assinatura com o segredo compartilhado.
    const expected = `sha256=${signWebhook(sub.secret, hit.headers['x-erp-timestamp'], hit.body)}`;
    expect(hit.headers['x-erp-signature']).toBe(expected);
    const delivery = await db('webhook_deliveries as d').join('integration_events as e', 'e.id', 'd.event_id').where('e.event_id', env.id).first('d.status', 'd.attempts');
    expect(delivery).toMatchObject({ status: 'SUCCESS', attempts: 1 });
    expect(await db('integration_logs').where({ direction: 'OUT', subscription_id: sub.id, status_code: 200 }).first('id')).toBeTruthy();
  });

  it('operação desfeita não gera evento (outbox na transação)', async () => {
    const m = (await admin.post('/api/mm/materials').set(H).send({ code: `NE-${crypto.randomBytes(3).toString('hex')}`, description: 'Sem estoque', material_type: 'HAWA', base_unit: 'UN', reference_price: 1 })).body.data;
    await admin.put(`/api/mm/materials/${m.id}/plants/${ids.cf10}`).set(H).send({ default_storage_location_id: ids.sla, min_stock: 0, reorder_point: 0, max_stock: 0 });
    await admin.post('/api/sd/prices').set(H).send({ material_id: m.id, sales_organization_id: await idByCode('sales_organizations', 'CF10'), price: 10, valid_from: plus(-1), valid_to: plus(30) });
    const so = (await admin.post('/api/sd/sales-orders').set(H).send({
      customer_id: await idByCode('customers', 'C0001'), sales_organization_id: await idByCode('sales_organizations', 'CF10'), distribution_channel_id: await idByCode('distribution_channels', '10'),
      division_id: await idByCode('divisions', '01'), plant_id: ids.cf10, requested_date: plus(2), allow_partial: false, items: [{ material_id: m.id, quantity: 5 }],
    })).body.data;
    expect((await admin.post(`/api/sd/sales-orders/${so.id}/submit`).set(H)).status).toBe(409);
    const events = await db('integration_events').where({ event_type: 'sales_order.confirmed' }).whereRaw('payload LIKE ?', [`%"number":"${so.number}"%`]);
    expect(events).toHaveLength(0);
    expect(await db('integration_events').where({ event_type: 'sales_order.created' }).whereRaw('payload LIKE ?', [`%"number":"${so.number}"%`]).first('id')).toBeTruthy();
  });

  it('estoque abaixo do ponto gera um alerta (e não repete em seguida)', async () => {
    const m = (await admin.post('/api/mm/materials').set(H).send({ code: `RP-${crypto.randomBytes(3).toString('hex')}`, description: 'Ponto de reposição', material_type: 'HAWA', base_unit: 'UN', reference_price: 1 })).body.data;
    await admin.put(`/api/mm/materials/${m.id}/plants/${ids.cf10}`).set(H).send({ default_storage_location_id: ids.sla, min_stock: 2, reorder_point: 10, max_stock: 30 });
    await admin.post('/api/mm/stock/movements').set(H).send({ movement_type: '561', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sla, quantity: 15, reason: 'Carga' });
    const exit = { movement_type: '201', material_id: m.id, plant_id: ids.cf10, storage_location_id: ids.sla, reason: 'Consumo' };
    await admin.post('/api/mm/stock/movements').set(H).send({ ...exit, quantity: 3 }); // 12 > 10: sem alerta
    await admin.post('/api/mm/stock/movements').set(H).send({ ...exit, quantity: 4 }); // 8 ≤ 10: alerta
    await admin.post('/api/mm/stock/movements').set(H).send({ ...exit, quantity: 1 }); // 7: não repete
    const evs = await db('integration_events').where({ dedupe_key: `below:${m.id}:${ids.cf10}` });
    expect(evs).toHaveLength(1);
    const payload = typeof evs[0].payload === 'string' ? JSON.parse(evs[0].payload) : evs[0].payload;
    expect(payload).toMatchObject({ available_qty: 8, reorder_point: 10 });
  });

  it('receptor fora do ar: novas tentativas com espera crescente até DEAD; reenvio manual funciona', async () => {
    receiverStatus = 503;
    const ping = await admin.post(`/api/integration/webhooks/${sub.id}/test`).set(H);
    expect(ping.body.data).toMatchObject({ status: 'FAILED', attempts: 1, last_status_code: 503 });
    const deliveryId = ping.body.data.id;
    const next = (await db('webhook_deliveries').where({ id: deliveryId }).first('next_attempt_at')).next_attempt_at;
    expect(new Date(next).getTime()).toBeGreaterThan(Date.now() + 50_000); // ~1 min
    for (let i = 0; i < RETRY_MINUTES.length; i++) {
      await db('webhook_deliveries').where({ id: deliveryId }).update({ next_attempt_at: new Date(Date.now() - 1000) });
      await dispatchPending();
    }
    expect(await db('webhook_deliveries').where({ id: deliveryId }).first('status', 'attempts')).toMatchObject({ status: 'DEAD', attempts: 6 });
    receiverStatus = 200;
    const retry = await admin.post(`/api/integration/deliveries/${deliveryId}/retry`).set(H);
    expect(retry.body.data.status).toBe('SUCCESS');
  });

  it('assinatura só com os eventos escolhidos', async () => {
    const only = (await admin.post('/api/integration/webhooks').set(H).send({ name: 'Só faturas', url: receiverUrl, events: ['billing.created'] })).body.data;
    await dispatchPending();
    const arroz = await idByCode('materials', 'ALM-0001');
    await comprador.post('/api/mm/purchase-requisitions').set(H).send({ plant_id: ids.cf10, justification: 'Filtro de eventos', items: [{ material_id: arroz, quantity: 1, need_date: plus(3) }] });
    await dispatchPending();
    expect(await db('webhook_deliveries').where({ subscription_id: only.id }).first('id')).toBeUndefined();
  });

  it('a tela de eventos mostra o evento com o status da entrega', async () => {
    const res = await admin.get('/api/integration/events?type=purchase_requisition.created&pageSize=5');
    expect(res.body.data[0].deliveries[0]).toMatchObject({ status: 'SUCCESS', subscription: 'n8n local (teste)' });
  });

  it('URL inválida e evento desconhecido são recusados', async () => {
    expect((await admin.post('/api/integration/webhooks').set(H).send({ name: 'X', url: 'ftp://x', events: ['*'] })).status).toBe(400);
    expect((await admin.post('/api/integration/webhooks').set(H).send({ name: 'X', url: receiverUrl, events: ['nao.existe'] })).status).toBe(400);
  });
});

describe('documentação OpenAPI', () => {
  it('especificação 3.1 com as rotas de integração e os webhooks', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.description).toMatch(/Não é\*\* API SAP|não é\*\* API SAP|\*\*Não é\*\* API SAP/i);
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/kpis/summary', '/mm/stock', '/sd/sales-orders', '/flow/{type}/{id}']));
    expect(Object.keys(res.body.webhooks)).toEqual(expect.arrayContaining(['stock.below_reorder_point', 'billing.created']));
  });

  it('Swagger UI com CSP própria', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/swagger-ui-dist@5\.17\.14/);
    expect(res.headers['content-security-policy']).toMatch(/cdn\.jsdelivr\.net/);
  });
});

describe('cenário 15: assistente de IA consulta e cita a fonte', () => {
  const ask = (agent, message) => agent.post('/api/assistant/chat').set(H).send({ message });

  it('modo determinista: materiais abaixo do ponto, com fonte montada pelo sistema', async () => {
    const res = await ask(admin, 'Quais materiais estão abaixo do ponto de reposição?');
    expect(res.status).toBe(200);
    expect(res.body.data.mode).toBe('DETERMINISTIC');
    expect(res.body.data.answer).toMatch(/^Fatos/m);
    expect(res.body.data.sources[0]).toMatchObject({ tool: 'materiais_abaixo_do_ponto', endpoint: expect.stringContaining('/api/mm/stock') });
  });

  it('custo estimado de reposição = soma do MRP (cálculo determinista), em "Estimativas"', async () => {
    const res = await ask(admin, 'Qual é o custo estimado de reposição?');
    const mrp = await admin.post('/api/mm/mrp/run').set(H).send({});
    const total = mrp.body.meta.total_estimated_value;
    expect(res.body.data.sources[0].tool).toBe('custo_estimado_de_reposicao');
    if (total > 0) {
      expect(res.body.data.answer).toMatch(/Estimativas/);
      expect(res.body.data.answer).toContain(total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
    }
  });

  it('respeita as permissões de quem pergunta: vendedor não obtém pedidos de compra pela IA', async () => {
    const res = await ask(vendedor, 'Quais pedidos de compra estão atrasados?');
    expect(res.body.data.denied).toEqual([expect.objectContaining({ tool: 'pedidos_de_compra_atrasados' })]);
    expect(res.body.data.sources).toEqual([]);
    expect(res.body.data.answer).toMatch(/Sem permissão/);
  });

  it('respeita o escopo: vendedor do CF10 só vê pedidos de venda do CF10', async () => {
    const res = await ask(vendedor, 'Quais pedidos de venda ainda não foram entregues?');
    const docs = res.body.data.sources[0]?.documents ?? [];
    for (const number of docs) {
      expect((await db('sales_orders as o').join('plants as p', 'p.id', 'o.plant_id').where('o.number', number).first('p.code')).code).toBe('CF10');
    }
  });

  it('pergunta fora do repertório recebe a lista do que o assistente sabe responder', async () => {
    const res = await ask(admin, 'Qual é a capital da França?');
    expect(res.body.data.answer).toMatch(/Não reconheci a pergunta/);
    expect(res.body.data.sources).toEqual([]);
  });

  it('o assistente não executa operações: "crie uma requisição" não cria nada', async () => {
    const before = Number((await db('purchase_requisitions').count({ n: '*' }))[0].n);
    await ask(admin, 'Crie uma requisição de 100 arroz e aprove');
    expect(Number((await db('purchase_requisitions').count({ n: '*' }))[0].n)).toBe(before);
  });

  it('modo LLM (Gemini simulado): o modelo chama a ferramenta e a fonte vem do backend', async () => {
    const original = config.ai.geminiKey;
    config.ai.geminiKey = 'chave-falsa-de-teste';
    const realFetch = globalThis.fetch;
    const calls = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, init);
      const payload = JSON.parse(init.body);
      calls.push(payload);
      const hasToolResult = payload.contents.some((c) => c.parts.some((p) => p.functionResponse));
      const parts = hasToolResult
        ? [{ text: 'Fatos\nHá materiais no ponto de reposição (ver fonte).' }]
        : [{ functionCall: { name: 'materiais_abaixo_do_ponto', args: {} } }];
      return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }), { status: 200 });
    });
    try {
      const res = await ask(admin, 'O que preciso repor?');
      expect(res.body.data.mode).toBe('LLM');
      expect(res.body.data.sources[0].tool).toBe('materiais_abaixo_do_ponto');
      expect(calls[0].tools[0].functionDeclarations.map((f) => f.name)).toContain('materiais_abaixo_do_ponto');
      expect(calls[0].systemInstruction.parts[0].text).toMatch(/Nunca invente/);
      // Para o vendedor, as ferramentas de compras nem são oferecidas ao modelo.
      calls.length = 0;
      await ask(vendedor, 'O que preciso repor?');
      expect(calls[0].tools[0].functionDeclarations.map((f) => f.name)).not.toContain('pedidos_de_compra_atrasados');
    } finally {
      spy.mockRestore();
      config.ai.geminiKey = original;
    }
  });

  it('se o Gemini falhar, responde no modo determinista e avisa', async () => {
    const original = config.ai.geminiKey;
    config.ai.geminiKey = 'chave-falsa-de-teste';
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => (String(url).includes('generativelanguage') ? new Response('{}', { status: 429 }) : realFetch(url, init)));
    try {
      const res = await ask(admin, 'Qual categoria vendeu mais?');
      expect(res.body.data.mode).toBe('DETERMINISTIC');
      expect(res.body.data.fallback_reason).toMatch(/modo determinista/);
      expect(res.body.data.sources[0].tool).toBe('vendas_por_categoria');
    } finally {
      spy.mockRestore();
      config.ai.geminiKey = original;
    }
  });

  it('consultas ficam registradas (sem segredos) e quem não tem a permissão não usa', async () => {
    const logged = await db('ai_queries').orderBy('id', 'desc').first();
    expect(logged).toMatchObject({ question: expect.any(String), mode: expect.stringMatching(/LLM|DETERMINISTIC/) });
    expect(JSON.stringify(logged)).not.toContain('chave-falsa');
    const semRole = await loginAs(await createUser({ roles: [] }));
    expect((await semRole.post('/api/assistant/chat').set(H).send({ message: 'Qual categoria vendeu mais?' })).status).toBe(403);
  });

  it('capabilities mostram ao usuário o que ele pode perguntar', async () => {
    const res = await vendedor.get('/api/assistant/capabilities');
    const allowed = Object.fromEntries(res.body.data.tools.map((t) => [t.name, t.allowed]));
    expect(allowed.pedidos_de_venda_nao_entregues).toBe(true);
    expect(allowed.pedidos_de_compra_atrasados).toBe(false);
  });
});
