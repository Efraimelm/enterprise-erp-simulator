// Ferramentas do assistente: SOMENTE LEITURA, executadas com o usuário que pergunta (req.user).
// Cada uma confere a permissão, aplica o escopo por centro e devolve dados + fonte rastreável.
// Totais e custos são calculados aqui (determinista), nunca pelo modelo de linguagem.
import { db } from '../../db.js';
import { money, qty } from '../../lib/numbers.js';
import { scopePlants } from '../mm/common.js';
import { computeMrp } from '../mm/mrp.js';

const today = () => new Date().toISOString().slice(0, 10);
const OPEN_PO = ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];

function plantFilter(qb, req, col, plantCode) {
  scopePlants(qb, req, col);
  if (plantCode) qb.whereIn(col, db('plants').where({ code: plantCode }).select('id'));
  return qb;
}

export const TOOLS = {
  materiais_abaixo_do_ponto: {
    description: 'Lista materiais cujo estoque disponível no centro está no ponto de reposição ou abaixo.',
    permission: ['MM.STOCK.READ'],
    async run(req, { plant_code: plantCode } = {}) {
      const rows = await plantFilter(db('material_plant_data as d'), req, 'd.plant_id', plantCode)
        .join('materials as m', 'm.id', 'd.material_id').join('plants as p', 'p.id', 'd.plant_id')
        .where('d.reorder_point', '>', 0)
        .select('m.code', 'm.description', 'm.base_unit', 'p.code as plant', 'd.reorder_point', 'd.min_stock',
          db.raw('(SELECT COALESCE(SUM(b.physical_qty - b.reserved_qty), 0) FROM stock_balances b WHERE b.material_id = d.material_id AND b.plant_id = d.plant_id) as available'))
        .havingRaw('available <= d.reorder_point').orderBy(['p.code', 'm.code']);
      return {
        rows: rows.map((r) => ({ material: r.code, descricao: r.description, centro: r.plant, disponivel: qty(r.available), ponto_de_reposicao: r.reorder_point, abaixo_do_minimo: r.available < r.min_stock, unidade: r.base_unit })),
        endpoint: 'GET /api/mm/stock?below_reorder=true',
        documents: rows.map((r) => `${r.code}@${r.plant}`),
      };
    },
  },

  custo_estimado_de_reposicao: {
    description: 'Calcula o custo estimado para repor os materiais que precisam de compra (MRP simplificado: até o estoque máximo, melhor preço de fornecedor).',
    permission: ['MM.STOCK.READ'],
    async run(req, { plant_code: plantCode } = {}) {
      const plantId = plantCode ? (await db('plants').where({ code: plantCode }).first('id'))?.id : undefined;
      const suggestions = plantCode && !plantId ? [] : await computeMrp(req, plantId);
      const total = money(suggestions.reduce((s, x) => s + x.estimated_value, 0));
      return {
        rows: suggestions.map((s) => ({ material: s.material_code, centro: s.plant_code, comprar: s.suggested_qty, fornecedor: s.supplier?.code ?? 'sem fornecedor (preço de referência)', valor_estimado: s.estimated_value })),
        total_estimado: total,
        is_estimate: true,
        method: 'MRP simplificado: cobertura = disponível + pedidos + requisições abertos; repõe até o máximo; valor = quantidade × melhor preço de fornecedor ativo (ou preço de referência).',
        endpoint: 'POST /api/mm/mrp/run (cálculo, sem gerar documentos)',
        documents: suggestions.map((s) => `${s.material_code}@${s.plant_code}`),
      };
    },
  },

  pedidos_de_compra_atrasados: {
    description: 'Lista pedidos de compra aprovados/enviados/parcialmente recebidos com data de entrega já vencida.',
    permission: ['MM.PURCHASE_ORDER.READ'],
    async run(req, { plant_code: plantCode } = {}) {
      const rows = await plantFilter(db('purchase_orders as o'), req, 'o.plant_id', plantCode)
        .join('suppliers as s', 's.id', 'o.supplier_id').join('plants as p', 'p.id', 'o.plant_id')
        .whereIn('o.status', OPEN_PO).where('o.delivery_date', '<', today())
        .select('o.number', 'o.status', 'o.delivery_date', 'o.total_gross', 's.name as supplier', 'p.code as plant').orderBy('o.delivery_date');
      return {
        rows: rows.map((r) => ({ pedido: r.number, fornecedor: r.supplier, centro: r.plant, entrega_prevista: r.delivery_date, status: r.status, valor: r.total_gross, dias_de_atraso: Math.round((Date.parse(today()) - Date.parse(r.delivery_date)) / 86400_000) })),
        endpoint: 'GET /api/mm/purchase-orders?open_for_receipt=true',
        documents: rows.map((r) => r.number),
      };
    },
  },

  fornecedores_com_pedidos_pendentes: {
    description: 'Agrupa por fornecedor os pedidos de compra ainda não recebidos por completo (rascunho a parcialmente recebido).',
    permission: ['MM.PURCHASE_ORDER.READ'],
    async run(req, { plant_code: plantCode } = {}) {
      const rows = await plantFilter(db('purchase_orders as o'), req, 'o.plant_id', plantCode)
        .join('suppliers as s', 's.id', 'o.supplier_id')
        .whereIn('o.status', ['DRAFT', 'PENDING_APPROVAL', ...OPEN_PO])
        .groupBy('s.id', 's.code', 's.name')
        .select('s.code', 's.name', db.raw('COUNT(*) as pedidos'), db.raw('SUM(o.total_gross) as valor'), db.raw("GROUP_CONCAT(o.number ORDER BY o.number SEPARATOR ',') as numeros"))
        .orderBy('valor', 'desc');
      return {
        rows: rows.map((r) => ({ fornecedor: `${r.code} – ${r.name}`, pedidos_pendentes: Number(r.pedidos), valor: money(r.valor), pedidos: r.numeros.split(',') })),
        endpoint: 'GET /api/mm/purchase-orders?supplier_id=…',
        documents: rows.flatMap((r) => r.numeros.split(',')),
      };
    },
  },

  vendas_por_categoria: {
    description: 'Soma o faturamento líquido (faturas ativas, já descontados os estornos) por categoria de material.',
    permission: ['SD.BILLING.READ'],
    async run(req, { plant_code: plantCode } = {}) {
      const rows = await plantFilter(db('billing_items as i'), req, 'b.plant_id', plantCode)
        .join('billing_documents as b', 'b.id', 'i.billing_document_id').join('materials as m', 'm.id', 'i.material_id')
        .where({ 'b.type': 'INVOICE', 'b.status': 'ACTIVE' })
        .groupBy('m.category')
        .select(db.raw("COALESCE(m.category, 'Sem categoria') as categoria"), db.raw('SUM(i.net_amount) as liquido'), db.raw('SUM(i.quantity) as quantidade'), db.raw("GROUP_CONCAT(DISTINCT b.number ORDER BY b.number SEPARATOR ',') as faturas"))
        .orderBy('liquido', 'desc');
      return {
        rows: rows.map((r) => ({ categoria: r.categoria, faturamento_liquido: money(r.liquido), quantidade: qty(r.quantidade) })),
        endpoint: 'GET /api/sd/billing?type=INVOICE&status=ACTIVE',
        documents: [...new Set(rows.flatMap((r) => r.faturas.split(',')))],
      };
    },
  },

  pedidos_de_venda_nao_entregues: {
    description: 'Lista pedidos de venda confirmados que ainda não foram totalmente entregues.',
    permission: ['SD.SALES_ORDER.READ'],
    async run(req, { plant_code: plantCode } = {}) {
      const rows = await plantFilter(db('sales_orders as o'), req, 'o.plant_id', plantCode)
        .join('customers as c', 'c.id', 'o.customer_id')
        .whereIn('o.status', ['CONFIRMED', 'IN_DELIVERY', 'PARTIALLY_DELIVERED'])
        .select('o.number', 'o.status', 'o.requested_date', 'o.total_gross', 'c.name as customer',
          db.raw('(SELECT SUM(i.quantity - i.delivered_qty) FROM sales_order_items i WHERE i.sales_order_id = o.id) as pendente'))
        .orderBy('o.requested_date');
      return {
        rows: rows.map((r) => ({ pedido: r.number, cliente: r.customer, status: r.status, data_desejada: r.requested_date, quantidade_pendente: qty(r.pendente), valor: r.total_gross, atrasado: r.requested_date < today() })),
        endpoint: 'GET /api/sd/sales-orders?deliverable=true',
        documents: rows.map((r) => r.number),
      };
    },
  },

  pedidos_de_venda_nao_faturados: {
    description: 'Lista pedidos de venda com mercadoria já entregue e ainda não faturada.',
    permission: ['SD.SALES_ORDER.READ'],
    async run(req, { plant_code: plantCode } = {}) {
      const rows = await plantFilter(db('sales_orders as o'), req, 'o.plant_id', plantCode)
        .join('customers as c', 'c.id', 'o.customer_id')
        .whereNot('o.status', 'CANCELLED')
        .whereExists(db('sales_order_items as i').whereRaw('i.sales_order_id = o.id').whereRaw('i.delivered_qty > i.billed_qty').select(db.raw(1)))
        .select('o.number', 'o.status', 'c.name as customer',
          db.raw('(SELECT SUM((i.delivered_qty - i.billed_qty) * i.unit_price * (1 - i.discount_pct / 100)) FROM sales_order_items i WHERE i.sales_order_id = o.id) as a_faturar'))
        .orderBy('o.number');
      return {
        rows: rows.map((r) => ({ pedido: r.number, cliente: r.customer, status: r.status, valor_liquido_a_faturar: money(r.a_faturar) })),
        endpoint: 'GET /api/sd/deliveries?unbilled=true',
        documents: rows.map((r) => r.number),
      };
    },
  },
};

export const canUseTool = (req, name) => TOOLS[name].permission.some((p) => req.user.permissions.has(p));

/** Executa uma ferramenta com as permissões de quem pergunta. Sem permissão: devolve "negado", sem dados. */
export async function runTool(req, name, args = {}) {
  const tool = TOOLS[name];
  if (!tool) return { name, error: 'ferramenta desconhecida' };
  if (!canUseTool(req, name)) return { name, denied: true, message: `Sem permissão (${tool.permission.join(' ou ')}).` };
  const plantCode = typeof args.plant_code === 'string' && /^[A-Z0-9]{1,4}$/i.test(args.plant_code) ? args.plant_code.toUpperCase() : undefined;
  const result = await tool.run(req, { plant_code: plantCode });
  return { name, ...result };
}
