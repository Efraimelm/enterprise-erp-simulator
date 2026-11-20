// Indicadores consolidados para o painel, o n8n (resumo diário) e o Power BI.
//   GET /api/kpis/summary?plant_id=   BI.KPI.READ   (sempre limitado ao escopo de quem consulta)
// Cada indicador vem com a fórmula em `definitions`, para ser rastreável.
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { money, qty } from '../../lib/numbers.js';
import { requirePermission } from '../../middleware/auth.js';
import { assertPlant, scopePlants, zId } from '../mm/common.js';
import { computeMrp } from '../mm/mrp.js';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
const n = (v) => Number(v ?? 0);

export const KPI_DEFINITIONS = {
  'estoque.materiais_abaixo_do_ponto': 'Pares material × centro com reorder_point > 0 e Σ(físico − reservado) ≤ ponto de reposição',
  'estoque.valor_estimado_reposicao': 'Soma do valor estimado das sugestões do MRP simplificado (quantidade × melhor preço de fornecedor ou preço de referência)',
  'compras.requisicoes_aguardando': 'Requisições com status PENDING_APPROVAL',
  'compras.pedidos_aguardando_aprovacao': 'Pedidos de compra com status PENDING_APPROVAL',
  'compras.pedidos_em_aberto': 'Pedidos APPROVED, SENT ou PARTIALLY_RECEIVED; valor = Σ total_gross',
  'compras.pedidos_atrasados': 'Pedidos em aberto com delivery_date < hoje',
  'vendas.pedidos_aguardando_aprovacao': 'Pedidos de venda com status PENDING_APPROVAL',
  'vendas.pedidos_a_entregar': 'Pedidos CONFIRMED, IN_DELIVERY ou PARTIALLY_DELIVERED; valor = Σ total_gross',
  'vendas.entregas_sem_saida': 'Entregas com status CREATED ou PICKED',
  'vendas.faturamento_mes': 'Σ total_gross de faturas e estornos ativos com billing_date no mês corrente (estornos são negativos)',
  'financeiro.titulos_em_aberto': 'Títulos OPEN ou PARTIALLY_PAID; valor = Σ(amount − paid_amount)',
  'financeiro.titulos_atrasados': 'Títulos em aberto com due_date < hoje',
};

export async function kpiSummary(req, plantId) {
  const scoped = (table, col = 'plant_id') => {
    const q = scopePlants(db(table), req, col);
    return plantId ? q.where(col, plantId) : q;
  };
  const OPEN_PO = ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];
  const OPEN_SO = ['CONFIRMED', 'IN_DELIVERY', 'PARTIALLY_DELIVERED'];

  const mrp = await computeMrp(req, plantId);
  const [belowReorder] = await scopePlants(db('material_plant_data as d'), req, 'd.plant_id').where((q) => { if (plantId) q.where('d.plant_id', plantId); })
    .where('d.reorder_point', '>', 0)
    .whereRaw('(SELECT COALESCE(SUM(b.physical_qty - b.reserved_qty), 0) FROM stock_balances b WHERE b.material_id = d.material_id AND b.plant_id = d.plant_id) <= d.reorder_point')
    .count({ n: '*' });
  const [prPending] = await scoped('purchase_requisitions').where({ status: 'PENDING_APPROVAL' }).count({ n: '*' });
  const [poPending] = await scoped('purchase_orders').where({ status: 'PENDING_APPROVAL' }).count({ n: '*' });
  const [poOpen] = await scoped('purchase_orders').whereIn('status', OPEN_PO).select(db.raw('COUNT(*) as n, COALESCE(SUM(total_gross), 0) as v'));
  const [poLate] = await scoped('purchase_orders').whereIn('status', OPEN_PO).where('delivery_date', '<', today()).count({ n: '*' });
  const [soPending] = await scoped('sales_orders').where({ status: 'PENDING_APPROVAL' }).count({ n: '*' });
  const [soOpen] = await scoped('sales_orders').whereIn('status', OPEN_SO).select(db.raw('COUNT(*) as n, COALESCE(SUM(total_gross), 0) as v'));
  const [delOpen] = await scoped('deliveries').whereIn('status', ['CREATED', 'PICKED']).count({ n: '*' });
  const [billMonth] = await scoped('billing_documents').where({ status: 'ACTIVE' }).where('billing_date', '>=', monthStart()).select(db.raw('COUNT(*) as n, COALESCE(SUM(total_gross), 0) as v'));
  const [arOpen] = await scoped('accounts_receivable').whereIn('status', ['OPEN', 'PARTIALLY_PAID']).select(db.raw('COUNT(*) as n, COALESCE(SUM(amount - paid_amount), 0) as v'));
  const [arLate] = await scoped('accounts_receivable').whereIn('status', ['OPEN', 'PARTIALLY_PAID']).where('due_date', '<', today()).select(db.raw('COUNT(*) as n, COALESCE(SUM(amount - paid_amount), 0) as v'));

  return {
    generated_at: new Date().toISOString(),
    scope: plantId ? { plant_id: plantId } : { plants: req.user.scope.all ? 'todos' : [...req.user.scope.plantIds] },
    currency: 'BRL',
    estoque: {
      materiais_abaixo_do_ponto: n(belowReorder.n),
      sugestoes_mrp: mrp.length,
      valor_estimado_reposicao: money(mrp.reduce((s, x) => s + x.estimated_value, 0)),
      itens_criticos: mrp.slice(0, 5).map((x) => ({ material: x.material_code, centro: x.plant_code, disponivel: qty(x.available_qty), ponto: x.reorder_point, sugerido: x.suggested_qty })),
    },
    compras: {
      requisicoes_aguardando: n(prPending.n),
      pedidos_aguardando_aprovacao: n(poPending.n),
      pedidos_em_aberto: n(poOpen.n),
      valor_pedidos_em_aberto: money(poOpen.v),
      pedidos_atrasados: n(poLate.n),
    },
    vendas: {
      pedidos_aguardando_aprovacao: n(soPending.n),
      pedidos_a_entregar: n(soOpen.n),
      valor_pedidos_a_entregar: money(soOpen.v),
      entregas_sem_saida: n(delOpen.n),
      faturas_no_mes: n(billMonth.n),
      faturamento_mes: money(billMonth.v),
    },
    financeiro: {
      titulos_em_aberto: n(arOpen.n),
      valor_em_aberto: money(arOpen.v),
      titulos_atrasados: n(arLate.n),
      valor_atrasado: money(arLate.v),
    },
    definitions: KPI_DEFINITIONS,
  };
}

export const kpisRouter = Router();

kpisRouter.get('/summary', requirePermission('BI.KPI.READ'), async (req, res) => {
  const { plant_id: plantId } = z.object({ plant_id: zId.optional() }).parse(req.query);
  if (plantId) await assertPlant(req, plantId);
  res.json({ data: await kpiSummary(req, plantId) });
});
