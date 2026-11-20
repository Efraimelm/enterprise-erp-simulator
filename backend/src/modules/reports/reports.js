// Definição dos relatórios de BI (Etapa 7). Fórmulas documentadas em docs/bi-design.md e
// devolvidas na própria resposta (campo `definition`), para que todo número seja rastreável.
import { db } from '../../db.js';
import { money, qty, round } from '../../lib/numbers.js';
import { scopePlants } from '../mm/common.js';

const EXITS = ['601', '201', '702'];
const ENTRIES = ['101', '561', '701'];
const OPEN_PO = ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];
const OPEN_SO = ['CONFIRMED', 'IN_DELIVERY', 'PARTIALLY_DELIVERED'];
const today = () => new Date().toISOString().slice(0, 10);
const dayEnd = (d) => new Date(`${d}T23:59:59.999Z`);
const dayStart = (d) => new Date(`${d}T00:00:00.000Z`);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

/** Aplica o escopo e o filtro de centro opcional. */
function plants(qb, req, col, f) {
  scopePlants(qb, req, col);
  if (f.plant_id) qb.where(col, f.plant_id);
  return qb;
}

export const REPORTS = {
  'stock-position': {
    title: 'Posição de estoque',
    group: 'Estoque',
    permission: 'MM.STOCK.READ',
    period: false,
    definition: 'Por material × depósito: disponível = físico − reservado; valor = físico × preço de referência (avaliação simulada, não é custo contábil); "abaixo do ponto" quando o disponível somado do centro ≤ ponto de reposição.',
    columns: [
      { key: 'material', label: 'Material', type: 'text' }, { key: 'descricao', label: 'Descrição', type: 'text' }, { key: 'categoria', label: 'Categoria', type: 'text' },
      { key: 'centro', label: 'Centro', type: 'text' }, { key: 'deposito', label: 'Depósito', type: 'text' }, { key: 'unidade', label: 'Unidade', type: 'text' },
      { key: 'fisico', label: 'Físico', type: 'qty' }, { key: 'reservado', label: 'Reservado', type: 'qty' }, { key: 'disponivel', label: 'Disponível', type: 'qty' },
      { key: 'preco_referencia', label: 'Preço de referência', type: 'money' }, { key: 'valor', label: 'Valor (simulado)', type: 'money' },
      { key: 'ponto_reposicao', label: 'Ponto de reposição', type: 'qty' }, { key: 'abaixo_do_ponto', label: 'Abaixo do ponto', type: 'bool' },
    ],
    async run(req, f) {
      const rows = await plants(db('stock_balances as b'), req, 'b.plant_id', f)
        .join('materials as m', 'm.id', 'b.material_id').join('plants as p', 'p.id', 'b.plant_id').join('storage_locations as s', 's.id', 'b.storage_location_id')
        .leftJoin('material_plant_data as d', (j) => j.on('d.material_id', 'b.material_id').andOn('d.plant_id', 'b.plant_id'))
        .select('m.code', 'm.description', 'm.category', 'm.base_unit', 'm.reference_price', 'p.code as plant', 's.code as sloc', 'b.physical_qty', 'b.reserved_qty', 'd.reorder_point',
          db.raw('(SELECT COALESCE(SUM(b2.physical_qty - b2.reserved_qty), 0) FROM stock_balances b2 WHERE b2.material_id = b.material_id AND b2.plant_id = b.plant_id) as plant_available'))
        .orderBy(['m.code', 'p.code', 's.code']);
      const data = rows.map((r) => ({
        material: r.code, descricao: r.description, categoria: r.category ?? 'Sem categoria', centro: r.plant, deposito: r.sloc, unidade: r.base_unit,
        fisico: qty(r.physical_qty), reservado: qty(r.reserved_qty), disponivel: qty(r.physical_qty - r.reserved_qty),
        preco_referencia: money(r.reference_price), valor: money(r.physical_qty * r.reference_price),
        ponto_reposicao: r.reorder_point ?? 0, abaixo_do_ponto: (r.reorder_point ?? 0) > 0 && Number(r.plant_available) <= r.reorder_point,
      }));
      return { rows: data, totals: { linhas: data.length, valor: money(sum(data, 'valor')), abaixo_do_ponto: new Set(data.filter((r) => r.abaixo_do_ponto).map((r) => `${r.material}@${r.centro}`)).size } };
    },
  },

  'stock-turnover': {
    title: 'Giro de estoque',
    group: 'Estoque',
    permission: 'MM.STOCK.READ',
    period: true,
    definition: 'Por material × centro no período: inicial = Σ movimentos antes de "de"; final = Σ movimentos até "até"; saídas = Σ |qtd| de 601, 201 e 702; entradas = Σ de 101, 561 e 701 (311 é interno e não conta); médio = (inicial + final) / 2; giro = saídas / médio; cobertura (dias) = final ÷ (saídas / dias do período).',
    columns: [
      { key: 'material', label: 'Material', type: 'text' }, { key: 'descricao', label: 'Descrição', type: 'text' }, { key: 'centro', label: 'Centro', type: 'text' },
      { key: 'estoque_inicial', label: 'Estoque inicial', type: 'qty' }, { key: 'entradas', label: 'Entradas', type: 'qty' }, { key: 'saidas', label: 'Saídas', type: 'qty' },
      { key: 'estoque_final', label: 'Estoque final', type: 'qty' }, { key: 'estoque_medio', label: 'Estoque médio', type: 'qty' },
      { key: 'giro', label: 'Giro no período', type: 'number' }, { key: 'cobertura_dias', label: 'Cobertura (dias)', type: 'number' },
    ],
    async run(req, f) {
      const days = Math.max(1, daysBetween(f.from, f.to) + 1);
      const rows = await plants(db('stock_movements as mv'), req, 'mv.plant_id', f)
        .join('materials as m', 'm.id', 'mv.material_id').join('plants as p', 'p.id', 'mv.plant_id')
        .where('mv.posted_at', '<=', dayEnd(f.to))
        .groupBy('mv.material_id', 'mv.plant_id', 'm.code', 'm.description', 'p.code')
        .select('m.code', 'm.description', 'p.code as plant',
          db.raw('SUM(CASE WHEN mv.posted_at < ? THEN mv.quantity ELSE 0 END) as opening', [dayStart(f.from)]),
          db.raw('SUM(mv.quantity) as closing'),
          db.raw(`SUM(CASE WHEN mv.posted_at >= ? AND mv.movement_type IN (${EXITS.map(() => '?').join(',')}) THEN -mv.quantity ELSE 0 END) as exits`, [dayStart(f.from), ...EXITS]),
          db.raw(`SUM(CASE WHEN mv.posted_at >= ? AND mv.movement_type IN (${ENTRIES.map(() => '?').join(',')}) THEN mv.quantity ELSE 0 END) as entries`, [dayStart(f.from), ...ENTRIES]))
        .orderBy(['m.code', 'p.code']);
      const data = rows.map((r) => {
        const opening = qty(r.opening);
        const closing = qty(r.closing);
        const exits = qty(r.exits);
        const avg = qty((opening + closing) / 2);
        return {
          material: r.code, descricao: r.description, centro: r.plant, estoque_inicial: opening, entradas: qty(r.entries), saidas: exits,
          estoque_final: closing, estoque_medio: avg,
          giro: avg > 0 ? round(exits / avg, 2) : null,
          cobertura_dias: exits > 0 ? round(closing / (exits / days), 1) : null,
        };
      });
      return { rows: data, totals: { linhas: data.length, dias_do_periodo: days, saidas: qty(sum(data, 'saidas')), entradas: qty(sum(data, 'entradas')) } };
    },
  },

  'purchases-by-supplier': {
    title: 'Compras por fornecedor',
    group: 'Compras',
    permission: 'MM.PURCHASE_ORDER.READ',
    period: true,
    definition: 'Pedidos não cancelados criados no período, por fornecedor: valor bruto; valor recebido = Σ recebido × preço × (1 + imposto); % recebido; pontualidade = pedidos totalmente recebidos com o último recebimento até a data de entrega ÷ pedidos totalmente recebidos.',
    columns: [
      { key: 'fornecedor', label: 'Fornecedor', type: 'text' }, { key: 'pedidos', label: 'Pedidos', type: 'number' }, { key: 'valor_bruto', label: 'Valor bruto', type: 'money' },
      { key: 'valor_recebido', label: 'Valor recebido', type: 'money' }, { key: 'percentual_recebido', label: '% recebido', type: 'percent' },
      { key: 'pedidos_recebidos', label: 'Pedidos totalmente recebidos', type: 'number' }, { key: 'no_prazo', label: 'Recebidos no prazo', type: 'number' },
      { key: 'pontualidade', label: 'Pontualidade (%)', type: 'percent' },
    ],
    async run(req, f) {
      const orders = await plants(db('purchase_orders as o'), req, 'o.plant_id', f)
        .join('suppliers as s', 's.id', 'o.supplier_id')
        .whereNot('o.status', 'CANCELLED').where('o.created_at', '>=', dayStart(f.from)).where('o.created_at', '<=', dayEnd(f.to))
        .select('o.id', 'o.status', 'o.total_gross', 'o.delivery_date', 's.code', 's.name',
          db.raw('(SELECT COALESCE(SUM(i.received_qty * i.unit_price * (1 + i.tax_rate / 100)), 0) FROM purchase_order_items i WHERE i.purchase_order_id = o.id) as received_value'),
          db.raw('(SELECT MAX(g.posted_at) FROM goods_receipts g WHERE g.purchase_order_id = o.id) as last_receipt'));
      const by = new Map();
      for (const o of orders) {
        const k = `${o.code} – ${o.name}`;
        const r = by.get(k) ?? { fornecedor: k, pedidos: 0, valor_bruto: 0, valor_recebido: 0, pedidos_recebidos: 0, no_prazo: 0 };
        r.pedidos++;
        r.valor_bruto += Number(o.total_gross);
        r.valor_recebido += Number(o.received_value);
        if (o.status === 'RECEIVED') {
          r.pedidos_recebidos++;
          if (o.last_receipt && new Date(o.last_receipt).toISOString().slice(0, 10) <= o.delivery_date) r.no_prazo++;
        }
        by.set(k, r);
      }
      const data = [...by.values()].map((r) => ({
        ...r, valor_bruto: money(r.valor_bruto), valor_recebido: money(r.valor_recebido),
        percentual_recebido: r.valor_bruto > 0 ? round((r.valor_recebido / r.valor_bruto) * 100, 1) : 0,
        pontualidade: r.pedidos_recebidos > 0 ? round((r.no_prazo / r.pedidos_recebidos) * 100, 1) : null,
      })).sort((a, b) => b.valor_bruto - a.valor_bruto);
      return { rows: data, totals: { fornecedores: data.length, pedidos: sum(data, 'pedidos'), valor_bruto: money(sum(data, 'valor_bruto')), valor_recebido: money(sum(data, 'valor_recebido')) } };
    },
  },

  'open-purchase-orders': {
    title: 'Pedidos de compra pendentes e atrasados',
    group: 'Compras',
    permission: 'MM.PURCHASE_ORDER.READ',
    period: false,
    definition: 'Pedidos APPROVED, SENT ou PARTIALLY_RECEIVED. Valor pendente = Σ (pedido − recebido) × preço × (1 + imposto). Dias de atraso = hoje − data de entrega (quando positivo).',
    columns: [
      { key: 'pedido', label: 'Pedido', type: 'text' }, { key: 'fornecedor', label: 'Fornecedor', type: 'text' }, { key: 'centro', label: 'Centro', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' }, { key: 'entrega_prevista', label: 'Entrega prevista', type: 'date' },
      { key: 'valor_pendente', label: 'Valor pendente', type: 'money' }, { key: 'dias_de_atraso', label: 'Dias de atraso', type: 'number' }, { key: 'atrasado', label: 'Atrasado', type: 'bool' },
    ],
    async run(req, f) {
      const rows = await plants(db('purchase_orders as o'), req, 'o.plant_id', f)
        .join('suppliers as s', 's.id', 'o.supplier_id').join('plants as p', 'p.id', 'o.plant_id').whereIn('o.status', OPEN_PO)
        .select('o.number', 'o.status', 'o.delivery_date', 's.name', 'p.code as plant',
          db.raw('(SELECT COALESCE(SUM(GREATEST(i.quantity - i.received_qty, 0) * i.unit_price * (1 + i.tax_rate / 100)), 0) FROM purchase_order_items i WHERE i.purchase_order_id = o.id) as pending'))
        .orderBy('o.delivery_date');
      const t = today();
      const data = rows.map((r) => {
        const late = Math.max(0, daysBetween(r.delivery_date, t));
        return { pedido: r.number, fornecedor: r.name, centro: r.plant, status: r.status, entrega_prevista: r.delivery_date, valor_pendente: money(r.pending), dias_de_atraso: late, atrasado: late > 0 };
      });
      return { rows: data, totals: { pedidos: data.length, atrasados: data.filter((r) => r.atrasado).length, valor_pendente: money(sum(data, 'valor_pendente')) } };
    },
  },

  'sales-by-period': {
    title: 'Vendas por período e categoria',
    group: 'Vendas',
    permission: 'SD.BILLING.READ',
    period: true,
    definition: 'Faturas ativas (não estornadas) com data no período, agrupadas por dia ou mês e por categoria do material: líquido, imposto e bruto dos itens. Faturas estornadas não entram.',
    columns: [
      { key: 'periodo', label: 'Período', type: 'text' }, { key: 'categoria', label: 'Categoria', type: 'text' }, { key: 'faturas', label: 'Faturas', type: 'number' },
      { key: 'quantidade', label: 'Quantidade', type: 'qty' }, { key: 'liquido', label: 'Líquido', type: 'money' }, { key: 'imposto', label: 'Imposto', type: 'money' }, { key: 'bruto', label: 'Bruto', type: 'money' },
    ],
    async run(req, f) {
      const fmt = f.group === 'day' ? '%Y-%m-%d' : '%Y-%m';
      const rows = await plants(db('billing_items as i'), req, 'b.plant_id', f)
        .join('billing_documents as b', 'b.id', 'i.billing_document_id').join('materials as m', 'm.id', 'i.material_id')
        .where({ 'b.type': 'INVOICE', 'b.status': 'ACTIVE' }).whereBetween('b.billing_date', [f.from, f.to])
        .groupByRaw('DATE_FORMAT(b.billing_date, ?), m.category', [fmt])
        .select(db.raw('DATE_FORMAT(b.billing_date, ?) as periodo', [fmt]), db.raw("COALESCE(m.category, 'Sem categoria') as categoria"),
          db.raw('COUNT(DISTINCT b.id) as faturas'), db.raw('SUM(i.quantity) as quantidade'), db.raw('SUM(i.net_amount) as liquido'), db.raw('SUM(i.tax_amount) as imposto'))
        .orderBy([{ column: 'periodo' }, { column: 'liquido', order: 'desc' }]);
      const data = rows.map((r) => ({
        periodo: r.periodo, categoria: r.categoria, faturas: Number(r.faturas), quantidade: qty(r.quantidade),
        liquido: money(r.liquido), imposto: money(r.imposto), bruto: money(Number(r.liquido) + Number(r.imposto)),
      }));
      const byCategory = {};
      for (const r of data) byCategory[r.categoria] = money((byCategory[r.categoria] ?? 0) + r.liquido);
      return { rows: data, totals: { liquido: money(sum(data, 'liquido')), imposto: money(sum(data, 'imposto')), bruto: money(sum(data, 'bruto')), por_categoria: byCategory } };
    },
  },

  'open-sales-orders': {
    title: 'Pedidos de venda em aberto e entregas pendentes',
    group: 'Vendas',
    permission: 'SD.SALES_ORDER.READ',
    period: false,
    definition: 'Pedidos CONFIRMED, IN_DELIVERY ou PARTIALLY_DELIVERED. Pendente = Σ (pedido − entregue); valor pendente = Σ pendente × preço × (1 − desconto) × (1 + imposto); entregas sem saída = entregas CREATED ou PICKED; atraso em relação à data desejada.',
    columns: [
      { key: 'pedido', label: 'Pedido', type: 'text' }, { key: 'cliente', label: 'Cliente', type: 'text' }, { key: 'centro', label: 'Centro', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' }, { key: 'data_desejada', label: 'Data desejada', type: 'date' }, { key: 'quantidade_pendente', label: 'Qtd. pendente', type: 'qty' },
      { key: 'valor_pendente', label: 'Valor pendente', type: 'money' }, { key: 'entregas_sem_saida', label: 'Entregas sem saída', type: 'number' },
      { key: 'dias_de_atraso', label: 'Dias de atraso', type: 'number' },
    ],
    async run(req, f) {
      const rows = await plants(db('sales_orders as o'), req, 'o.plant_id', f)
        .join('customers as c', 'c.id', 'o.customer_id').join('plants as p', 'p.id', 'o.plant_id').whereIn('o.status', OPEN_SO)
        .select('o.number', 'o.status', 'o.requested_date', 'c.name', 'p.code as plant',
          db.raw('(SELECT COALESCE(SUM(i.quantity - i.delivered_qty), 0) FROM sales_order_items i WHERE i.sales_order_id = o.id) as pending_qty'),
          db.raw('(SELECT COALESCE(SUM((i.quantity - i.delivered_qty) * i.unit_price * (1 - i.discount_pct / 100) * (1 + i.tax_rate / 100)), 0) FROM sales_order_items i WHERE i.sales_order_id = o.id) as pending_value'),
          db.raw("(SELECT COUNT(*) FROM deliveries d WHERE d.sales_order_id = o.id AND d.status <> 'POSTED') as open_deliveries"))
        .orderBy('o.requested_date');
      const t = today();
      const data = rows.map((r) => ({
        pedido: r.number, cliente: r.name, centro: r.plant, status: r.status, data_desejada: r.requested_date, quantidade_pendente: qty(r.pending_qty),
        valor_pendente: money(r.pending_value), entregas_sem_saida: Number(r.open_deliveries), dias_de_atraso: Math.max(0, daysBetween(r.requested_date, t)),
      }));
      return { rows: data, totals: { pedidos: data.length, atrasados: data.filter((r) => r.dias_de_atraso > 0).length, valor_pendente: money(sum(data, 'valor_pendente')), entregas_sem_saida: sum(data, 'entregas_sem_saida') } };
    },
  },

  'receivables-aging': {
    title: 'Contas a receber por vencimento',
    group: 'Financeiro',
    permission: 'SD.RECEIVABLE.READ',
    period: false,
    definition: 'Títulos OPEN ou PARTIALLY_PAID hoje; em aberto = valor − pago; faixas por dias = hoje − vencimento: a vencer (≤ 0), 1–30, 31–60, 61–90, > 90. Simulado: não há contabilidade nem integração bancária.',
    columns: [
      { key: 'cliente', label: 'Cliente', type: 'text' }, { key: 'titulos', label: 'Títulos', type: 'number' }, { key: 'a_vencer', label: 'A vencer', type: 'money' },
      { key: 'd1_30', label: '1–30 dias', type: 'money' }, { key: 'd31_60', label: '31–60 dias', type: 'money' }, { key: 'd61_90', label: '61–90 dias', type: 'money' },
      { key: 'acima_90', label: 'Acima de 90 dias', type: 'money' }, { key: 'total', label: 'Total em aberto', type: 'money' },
    ],
    async run(req, f) {
      const rows = await plants(db('accounts_receivable as r'), req, 'r.plant_id', f)
        .join('customers as c', 'c.id', 'r.customer_id').whereIn('r.status', ['OPEN', 'PARTIALLY_PAID'])
        .select('c.code', 'c.name', 'r.due_date', db.raw('r.amount - r.paid_amount as open'));
      const t = today();
      const bucket = (due) => { const d = daysBetween(due, t); return d <= 0 ? 'a_vencer' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'acima_90'; };
      const by = new Map();
      for (const r of rows) {
        const k = `${r.code} – ${r.name}`;
        const x = by.get(k) ?? { cliente: k, titulos: 0, a_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, acima_90: 0, total: 0 };
        x.titulos++;
        x[bucket(r.due_date)] += Number(r.open);
        x.total += Number(r.open);
        by.set(k, x);
      }
      const keys = ['a_vencer', 'd1_30', 'd31_60', 'd61_90', 'acima_90', 'total'];
      const data = [...by.values()].map((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [k, money(x[k])])) })).sort((a, b) => b.total - a.total);
      return { rows: data, totals: { titulos: sum(data, 'titulos'), ...Object.fromEntries(keys.map((k) => [k, money(sum(data, k))])), data_base: t } };
    },
  },
};
