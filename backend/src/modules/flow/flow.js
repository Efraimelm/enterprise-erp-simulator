// Trilha de documentos de ponta a ponta (Etapa 5) e busca global por número.
// Desenho e decisões em docs/integration-design.md.
//
//   GET /api/flow/search?q=4500000001     encontra documentos pelo número
//   GET /api/flow/:type/:id               grafo { root, nodes, edges, hidden, truncated }
//
// Os vínculos vêm das chaves já gravadas nos documentos. A ligação compra ↔ venda (entrada 101 →
// saída 601) é uma atribuição FIFO SIMULADA sobre os movimentos de cada material × depósito:
// não é controle de lote nem custeio.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { qty } from '../../lib/numbers.js';
import { denyOutOfScope, requireAuth } from '../../middleware/auth.js';
import { MOVEMENT_TYPES } from '../mm/stock-service.js';

export const NODE_TYPES = {
  PURCHASE_REQ: { label: 'Requisição de compra', stage: 'Compras', permission: 'MM.PURCHASE_REQ.READ' },
  PURCHASE_ORDER: { label: 'Pedido de compra', stage: 'Compras', permission: 'MM.PURCHASE_ORDER.READ' },
  MATERIAL_DOC: { label: 'Documento de material', stage: 'Estoque', permission: 'MM.STOCK.READ' },
  SALES_ORDER: { label: 'Pedido de venda', stage: 'Vendas', permission: 'SD.SALES_ORDER.READ' },
  DELIVERY: { label: 'Entrega', stage: 'Vendas', permission: 'SD.SALES_ORDER.READ' },
  BILLING: { label: 'Fatura', stage: 'Financeiro', permission: 'SD.BILLING.READ' },
  RECEIVABLE: { label: 'Título a receber', stage: 'Financeiro', permission: 'SD.RECEIVABLE.READ' },
  PAYMENT: { label: 'Pagamento', stage: 'Financeiro', permission: 'SD.RECEIVABLE.READ' },
};

const key = (type, id) => `${type}:${id}`;
const inScope = (req, plantId) => req.user.scope.all || req.user.scope.plantIds.has(Number(plantId));
const canRead = (req, type) => req.user.permissions.has(NODE_TYPES[type].permission);

/* ───────── Carregar um nó ───────── */

async function loadNode(req, type, id) {
  const base = { key: key(type, id), type, id, typeLabel: NODE_TYPES[type].label, stage: NODE_TYPES[type].stage };
  switch (type) {
    case 'PURCHASE_REQ': {
      const r = await db('purchase_requisitions as r').join('plants as p', 'p.id', 'r.plant_id').where('r.id', id)
        .first('r.id', 'r.number', 'r.status', 'r.created_at', 'r.plant_id', 'p.code as plant_code', 'r.source',
          db.raw('(SELECT COALESCE(SUM(i.quantity * i.estimated_price), 0) FROM purchase_requisition_items i WHERE i.requisition_id = r.id) as amount'));
      return r && { ...base, number: r.number, status: r.status, date: r.created_at, plant_id: r.plant_id, plant_code: r.plant_code, amount: Number(r.amount), subtitle: r.source === 'MRP' ? 'origem: MRP' : 'origem: manual' };
    }
    case 'PURCHASE_ORDER': {
      const o = await db('purchase_orders as o').join('plants as p', 'p.id', 'o.plant_id').join('suppliers as s', 's.id', 'o.supplier_id').where('o.id', id)
        .first('o.id', 'o.number', 'o.status', 'o.created_at', 'o.plant_id', 'p.code as plant_code', 'o.total_gross', 'o.currency', 's.name as supplier');
      return o && { ...base, number: o.number, status: o.status, date: o.created_at, plant_id: o.plant_id, plant_code: o.plant_code, amount: o.total_gross, currency: o.currency, subtitle: o.supplier };
    }
    case 'MATERIAL_DOC': {
      const lines = await db('stock_movements as mv').join('materials as m', 'm.id', 'mv.material_id').join('storage_locations as s', 's.id', 'mv.storage_location_id')
        .join('plants as p', 'p.id', 'mv.plant_id').where('mv.doc_number', String(id))
        .select('mv.id', 'mv.line_no', 'mv.movement_type', 'mv.material_id', 'mv.storage_location_id', 'mv.plant_id', 'mv.quantity', 'mv.posted_at',
          'mv.reference_type', 'mv.reference_id', 'm.code as material_code', 'm.base_unit', 's.code as sloc_code', 'p.code as plant_code')
        .orderBy('mv.line_no');
      if (!lines.length) return null;
      const visible = lines.filter((l) => inScope(req, l.plant_id));
      const types = [...new Set(lines.map((l) => l.movement_type))];
      return {
        ...base, number: String(id), date: lines[0].posted_at, status: types.join('/'),
        plant_id: visible[0]?.plant_id ?? lines[0].plant_id, plant_code: [...new Set(visible.map((l) => l.plant_code))].join(', '),
        subtitle: types.map((t) => `${t} ${MOVEMENT_TYPES[t]?.label ?? ''}`).join(' · '),
        anyInScope: visible.length > 0, lines: visible,
        summary: visible.map((l) => `${l.material_code} ${l.quantity > 0 ? '+' : ''}${qty(l.quantity)} ${l.base_unit} (${l.plant_code}/${l.sloc_code})`),
      };
    }
    case 'SALES_ORDER': {
      const o = await db('sales_orders as o').join('plants as p', 'p.id', 'o.plant_id').join('customers as c', 'c.id', 'o.customer_id').where('o.id', id)
        .first('o.number', 'o.status', 'o.created_at', 'o.plant_id', 'p.code as plant_code', 'o.total_gross', 'o.currency', 'c.name as customer');
      return o && { ...base, number: o.number, status: o.status, date: o.created_at, plant_id: o.plant_id, plant_code: o.plant_code, amount: o.total_gross, currency: o.currency, subtitle: o.customer };
    }
    case 'DELIVERY': {
      const d = await db('deliveries as d').join('plants as p', 'p.id', 'd.plant_id').where('d.id', id)
        .first('d.number', 'd.status', 'd.created_at', 'd.posted_at', 'd.plant_id', 'p.code as plant_code', 'd.material_doc_number', 'd.sales_order_id');
      return d && { ...base, number: d.number, status: d.status, date: d.posted_at ?? d.created_at, plant_id: d.plant_id, plant_code: d.plant_code, raw: d };
    }
    case 'BILLING': {
      const b = await db('billing_documents as b').join('plants as p', 'p.id', 'b.plant_id').where('b.id', id)
        .first('b.number', 'b.type', 'b.status', 'b.billing_date', 'b.plant_id', 'p.code as plant_code', 'b.total_gross', 'b.currency', 'b.delivery_id', 'b.reference_billing_id');
      return b && {
        ...base, typeLabel: b.type === 'INVOICE' ? 'Fatura' : 'Estorno de fatura', number: b.number, status: b.status, date: b.billing_date,
        plant_id: b.plant_id, plant_code: b.plant_code, amount: b.total_gross, currency: b.currency, raw: b,
      };
    }
    case 'RECEIVABLE': {
      const r = await db('accounts_receivable as r').join('billing_documents as b', 'b.id', 'r.billing_document_id').join('plants as p', 'p.id', 'r.plant_id').where('r.id', id)
        .first('r.status', 'r.amount', 'r.paid_amount', 'r.due_date', 'r.issue_date', 'r.plant_id', 'p.code as plant_code', 'r.currency', 'r.billing_document_id', 'b.number as billing_number');
      return r && {
        ...base, number: `Título ${r.billing_number}`, status: r.status, date: r.issue_date, plant_id: r.plant_id, plant_code: r.plant_code,
        amount: r.amount, currency: r.currency, subtitle: `vence em ${r.due_date.split('-').reverse().join('/')}`, raw: r,
      };
    }
    case 'PAYMENT': {
      const p = await db('payments as y').join('accounts_receivable as r', 'r.id', 'y.receivable_id').join('plants as p', 'p.id', 'r.plant_id').where('y.id', id)
        .first('y.number', 'y.amount', 'y.payment_date', 'y.method', 'y.receivable_id', 'r.plant_id', 'p.code as plant_code', 'r.currency');
      return p && { ...base, number: p.number, status: p.method, date: p.payment_date, plant_id: p.plant_id, plant_code: p.plant_code, amount: p.amount, currency: p.currency, raw: p };
    }
    default:
      return null;
  }
}

/* ───────── FIFO simulado por material × depósito ───────── */

async function fifoFor(ctx, materialId, slocId) {
  const k = `${materialId}:${slocId}`;
  if (ctx.fifo.has(k)) return ctx.fifo.get(k);
  const movs = await db('stock_movements').where({ material_id: materialId, storage_location_id: slocId }).orderBy('id').select('id', 'doc_number', 'quantity');
  const layers = [];
  const sources = new Map(); // id da saída → [{ doc, qty }]
  const consumers = new Map(); // id da entrada → [{ doc, qty }]
  for (const m of movs) {
    if (m.quantity > 0) { layers.push({ m, rem: m.quantity }); continue; }
    let need = -m.quantity;
    const alloc = [];
    while (need > 1e-9 && layers.length) {
      const layer = layers[0];
      const take = Math.min(need, layer.rem);
      alloc.push({ doc: layer.m.doc_number, qty: take });
      if (!consumers.has(layer.m.id)) consumers.set(layer.m.id, []);
      consumers.get(layer.m.id).push({ doc: m.doc_number, qty: take });
      layer.rem -= take;
      need -= take;
      if (layer.rem <= 1e-9) layers.shift();
    }
    sources.set(m.id, alloc);
  }
  const result = { sources, consumers };
  ctx.fifo.set(k, result);
  return result;
}

/* ───────── Vizinhos de cada nó (com o sentido do processo) ───────── */

const edge = (from, to, label) => ({ from, to, label });

async function neighbors(req, node, ctx) {
  const out = []; // { type, id, dir, fifo, edge }
  const self = node.key;
  const add = (type, id, dir, label, fifo = false) => {
    const k = key(type, id);
    out.push({ type, id, dir, fifo, edge: dir === 'out' ? edge(self, k, label) : edge(k, self, label) });
  };
  switch (node.type) {
    case 'PURCHASE_REQ': {
      const pos = await db('purchase_requisition_items as i').join('purchase_order_items as poi', 'poi.id', 'i.purchase_order_item_id')
        .where('i.requisition_id', node.id).distinct().pluck('poi.purchase_order_id');
      pos.forEach((id) => add('PURCHASE_ORDER', id, 'out', 'convertida em'));
      break;
    }
    case 'PURCHASE_ORDER': {
      const prs = await db('purchase_requisition_items as i').join('purchase_order_items as poi', 'poi.id', 'i.purchase_order_item_id')
        .where('poi.purchase_order_id', node.id).distinct().pluck('i.requisition_id');
      prs.forEach((id) => add('PURCHASE_REQ', id, 'in', 'convertida em'));
      const grs = await db('goods_receipts').where({ purchase_order_id: node.id }).pluck('doc_number');
      grs.forEach((doc) => add('MATERIAL_DOC', doc, 'out', 'recebido em (101)'));
      break;
    }
    case 'MATERIAL_DOC': {
      const pairs = new Map(); // doc relacionado → { dir, qty }
      for (const l of node.lines) {
        if (l.reference_type === 'PURCHASE_ORDER') add('PURCHASE_ORDER', l.reference_id, 'in', 'recebido em (101)');
        if (l.reference_type === 'DELIVERY') add('DELIVERY', l.reference_id, 'in', 'saída de mercadoria (601)');
        const f = await fifoFor(ctx, l.material_id, l.storage_location_id);
        const list = l.quantity < 0 ? f.sources.get(l.id) ?? [] : f.consumers.get(l.id) ?? [];
        for (const a of list) {
          if (a.doc === node.number) continue; // transferência 311 dentro do próprio documento
          const pk = `${l.quantity < 0 ? 'in' : 'out'}:${a.doc}:${l.material_code}`;
          const prev = pairs.get(pk) ?? { dir: l.quantity < 0 ? 'in' : 'out', doc: a.doc, material: l.material_code, unit: l.base_unit, qty: 0 };
          prev.qty += a.qty;
          pairs.set(pk, prev);
        }
      }
      for (const p of pairs.values()) add('MATERIAL_DOC', p.doc, p.dir, `abasteceu ${qty(p.qty)} ${p.unit} de ${p.material} (FIFO simulado)`, true);
      break;
    }
    case 'SALES_ORDER': {
      const dels = await db('deliveries').where({ sales_order_id: node.id }).pluck('id');
      dels.forEach((id) => add('DELIVERY', id, 'out', 'entregue por'));
      break;
    }
    case 'DELIVERY': {
      add('SALES_ORDER', node.raw.sales_order_id, 'in', 'entregue por');
      if (node.raw.material_doc_number) add('MATERIAL_DOC', node.raw.material_doc_number, 'out', 'saída de mercadoria (601)');
      const bills = await db('billing_documents').where({ delivery_id: node.id, type: 'INVOICE' }).pluck('id');
      bills.forEach((id) => add('BILLING', id, 'out', 'faturada em'));
      break;
    }
    case 'BILLING': {
      if (node.raw.reference_billing_id) add('BILLING', node.raw.reference_billing_id, 'in', 'estornada por');
      else add('DELIVERY', node.raw.delivery_id, 'in', 'faturada em');
      const cancels = await db('billing_documents').where({ reference_billing_id: node.id }).pluck('id');
      cancels.forEach((id) => add('BILLING', id, 'out', 'estornada por'));
      const ar = await db('accounts_receivable').where({ billing_document_id: node.id }).first('id');
      if (ar) add('RECEIVABLE', ar.id, 'out', 'gerou o título');
      break;
    }
    case 'RECEIVABLE': {
      add('BILLING', node.raw.billing_document_id, 'in', 'gerou o título');
      const pays = await db('payments').where({ receivable_id: node.id }).pluck('id');
      pays.forEach((id) => add('PAYMENT', id, 'out', 'pago por'));
      break;
    }
    case 'PAYMENT':
      add('RECEIVABLE', node.raw.receivable_id, 'in', 'pago por');
      break;
    default:
  }
  return out;
}

function visible(req, node) {
  if (!node || !canRead(req, node.type)) return false;
  if (node.type === 'MATERIAL_DOC') return node.anyInScope;
  return inScope(req, node.plant_id);
}

/**
 * Monta o grafo a partir de um documento, em largura, respeitando permissão e escopo.
 *
 * Linhagem pelo FIFO: quem subiu por uma ligação FIFO (da saída para a entrada que a abasteceu) continua
 * só subindo pelo FIFO, e quem desceu continua só descendo. Sem isso, a trilha de uma venda subiria até a
 * carga inicial e desceria de novo para TODAS as outras vendas abastecidas por ela (documentos "irmãos",
 * que não fazem parte da história desta venda). As ligações de documento (pedido, entrega, fatura...) seguem normais.
 */
export async function buildFlow(req, rootType, rootId, { limit = 150 } = {}) {
  const root = await loadNode(req, rootType, rootId);
  if (!root) throw notFound('Documento não encontrado.');
  if (!canRead(req, rootType)) throw forbidden(`Você não tem a permissão ${NODE_TYPES[rootType].permission} para ver este documento.`);
  if (!visible(req, root)) throw await denyOutOfScope(req, { documento: root.number });

  const ctx = { fifo: new Map() };
  const nodes = new Map([[root.key, root]]);
  const edges = new Map();
  const hidden = new Set();
  const queue = [root];
  const fifoDir = new Map([[root.key, 'both']]); // sentido FIFO permitido a partir de cada nó
  let truncated = false;

  while (queue.length) {
    const node = queue.shift();
    const allowed = fifoDir.get(node.key);
    for (const nb of await neighbors(req, node, ctx)) {
      if (nb.fifo && allowed !== 'both' && nb.dir !== allowed) continue;
      edges.set(`${nb.edge.from}>${nb.edge.to}`, nb.edge);
      const k = key(nb.type, nb.id);
      if (nodes.has(k) || hidden.has(k)) continue;
      if (nodes.size >= limit) { truncated = true; continue; }
      const loaded = await loadNode(req, nb.type, nb.id);
      if (!visible(req, loaded)) { hidden.add(k); continue; }
      nodes.set(k, loaded);
      fifoDir.set(k, nb.fifo ? nb.dir : allowed);
      queue.push(loaded);
    }
  }

  const clean = ({ raw, lines, anyInScope, ...n }) => n;
  return {
    root: root.key,
    nodes: [...nodes.values()].map(clean),
    edges: [...edges.values()].filter((e) => nodes.has(e.from) && nodes.has(e.to)),
    hidden: hidden.size,
    truncated,
    note: 'Ligações entre recebimentos e saídas calculadas por FIFO simulado sobre os movimentos de cada material e depósito (sem controle de lote).',
  };
}

/* ───────── Rotas ───────── */

export const flowRouter = Router();

flowRouter.get('/search', requireAuth, async (req, res) => {
  const { q } = z.object({ q: z.string().trim().regex(/^\d{1,10}$/, 'Digite o número do documento (só números).') }).parse(req.query);
  const prefix = `${q}%`;
  const found = [];
  const push = (type, rows, extra = () => ({})) => rows.forEach((r) => found.push({ type, id: r.id, number: r.number, plant_id: r.plant_id, typeLabel: NODE_TYPES[type].label, ...extra(r) }));
  push('PURCHASE_REQ', await db('purchase_requisitions').where('number', 'like', prefix).limit(5).select('id', 'number', 'plant_id'));
  push('PURCHASE_ORDER', await db('purchase_orders').where('number', 'like', prefix).limit(5).select('id', 'number', 'plant_id'));
  push('MATERIAL_DOC', await db('stock_movements').where('doc_number', 'like', prefix).groupBy('doc_number').limit(5).select('doc_number as id', 'doc_number as number', db.raw('MIN(plant_id) as plant_id')));
  push('SALES_ORDER', await db('sales_orders').where('number', 'like', prefix).limit(5).select('id', 'number', 'plant_id'));
  push('DELIVERY', await db('deliveries').where('number', 'like', prefix).limit(5).select('id', 'number', 'plant_id'));
  push('BILLING', await db('billing_documents').where('number', 'like', prefix).limit(5).select('id', 'number', 'plant_id', 'type'), (r) => ({ typeLabel: r.type === 'INVOICE' ? 'Fatura' : 'Estorno de fatura' }));
  push('PAYMENT', await db('payments as y').join('accounts_receivable as r', 'r.id', 'y.receivable_id').where('y.number', 'like', prefix).limit(5).select('y.id', 'y.number', 'r.plant_id'));
  const allowed = [];
  for (const f of found) {
    if (!canRead(req, f.type)) continue;
    if (f.type === 'MATERIAL_DOC') {
      const plants = await db('stock_movements').where({ doc_number: f.number }).distinct().pluck('plant_id');
      if (!plants.some((p) => inScope(req, p))) continue;
    } else if (!inScope(req, f.plant_id)) continue;
    const { plant_id: _p, ...rest } = f;
    allowed.push(rest);
  }
  res.json({ data: allowed.sort((a, b) => (a.number === q ? -1 : b.number === q ? 1 : a.number.localeCompare(b.number))).slice(0, 20) });
});

flowRouter.get('/:type/:id', requireAuth, async (req, res) => {
  const type = String(req.params.type).toUpperCase();
  if (!NODE_TYPES[type]) throw badRequest(`Tipo de documento desconhecido. Use: ${Object.keys(NODE_TYPES).join(', ')}.`);
  if (req.user.must_change_password) throw forbidden('Troque sua senha antes de continuar.', 'PASSWORD_CHANGE_REQUIRED');
  const id = type === 'MATERIAL_DOC' ? String(req.params.id) : Number(req.params.id);
  if (type !== 'MATERIAL_DOC' && (!Number.isInteger(id) || id <= 0)) throw notFound('Documento não encontrado.');
  res.json({ data: await buildFlow(req, type, id) });
});
