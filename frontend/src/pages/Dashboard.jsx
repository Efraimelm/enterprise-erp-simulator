import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { roadmap } from '../modules.js';

const COUNTERS = [
  { key: 'companies', label: 'Empresas' },
  { key: 'plants', label: 'Centros' },
  { key: 'storage-locations', label: 'Depósitos' },
  { key: 'sales-areas', label: 'Áreas de vendas' },
  { key: 'purchasing-organizations', label: 'Org. de compras' },
  { key: 'purchasing-groups', label: 'Grupos de compradores' },
];

const STATUS = { done: 'Concluída', next: 'Próxima', planned: 'Planejada' };

export default function Dashboard() {
  const { user, can } = useAuth();
  const [counts, setCounts] = useState({});

  const [mm, setMm] = useState(null);
  useEffect(() => {
    const jobs = [];
    if (can('MM.STOCK.READ')) jobs.push(api('/mm/stock?pageSize=1&below_reorder=true').then((r) => ['belowReorder', r.total]));
    if (can('MM.PURCHASE_REQ.READ')) jobs.push(api('/mm/purchase-requisitions?pageSize=1&status=PENDING_APPROVAL').then((r) => ['prPending', r.total]));
    if (can('MM.PURCHASE_ORDER.READ')) {
      jobs.push(api('/mm/purchase-orders?pageSize=1&status=PENDING_APPROVAL').then((r) => ['poPending', r.total]));
      jobs.push(api('/mm/purchase-orders?pageSize=1&open_for_receipt=true').then((r) => ['poOpen', r.total]));
    }
    if (can('SD.SALES_ORDER.READ')) {
      jobs.push(api('/sd/sales-orders?pageSize=1&status=PENDING_APPROVAL').then((r) => ['soPending', r.total]));
      jobs.push(api('/sd/sales-orders?pageSize=1&deliverable=true').then((r) => ['soOpen', r.total]));
    }
    if (can('SD.RECEIVABLE.READ')) jobs.push(api('/sd/receivables?pageSize=1&overdue=true').then((r) => ['arOverdue', r.total]));
    if (jobs.length) Promise.all(jobs).then((p) => setMm(Object.fromEntries(p))).catch(() => {});
  }, [can]);

  useEffect(() => {
    if (!can('ADMIN.ORG.READ')) return;
    Promise.all(COUNTERS.map((c) => api(`/org/${c.key}?pageSize=1&is_active=true`).then((r) => [c.key, r.total])))
      .then((pairs) => setCounts(Object.fromEntries(pairs)))
      .catch(() => {});
  }, [can]);

  return (
    <>
      <div className="page-header">
        <h1>Olá, {user.full_name.split(' ')[0]}</h1>
        <p className="hint">Comércio Forte Ltda · empresa fictícia de demonstração</p>
      </div>

      {mm && (
        <section className="tiles" aria-label="Compras, estoque e vendas">
          {mm.belowReorder !== undefined && <Link to="/mm/estoque" className="tile"><span className="tile-value">{mm.belowReorder}</span><span className="tile-label">Saldos abaixo do ponto de reposição</span></Link>}
          {mm.prPending !== undefined && <Link to="/mm/requisicoes" className="tile"><span className="tile-value">{mm.prPending}</span><span className="tile-label">Requisições aguardando aprovação</span></Link>}
          {mm.poPending !== undefined && <Link to="/mm/pedidos" className="tile"><span className="tile-value">{mm.poPending}</span><span className="tile-label">Pedidos aguardando aprovação</span></Link>}
          {mm.poOpen !== undefined && <Link to="/mm/recebimentos" className="tile"><span className="tile-value">{mm.poOpen}</span><span className="tile-label">Pedidos a receber</span></Link>}
          {mm.soPending !== undefined && <Link to="/sd/pedidos" className="tile"><span className="tile-value">{mm.soPending}</span><span className="tile-label">Vendas aguardando aprovação</span></Link>}
          {mm.soOpen !== undefined && <Link to="/sd/entregas" className="tile"><span className="tile-value">{mm.soOpen}</span><span className="tile-label">Vendas a entregar</span></Link>}
          {mm.arOverdue !== undefined && <Link to="/sd/contas-a-receber" className="tile"><span className="tile-value">{mm.arOverdue}</span><span className="tile-label">Títulos atrasados</span></Link>}
        </section>
      )}

      {can('ADMIN.ORG.READ') && (
        <section className="tiles" aria-label="Estrutura organizacional ativa">
          {COUNTERS.map((c) => (
            <Link key={c.key} to={`/admin/estrutura/${c.key}`} className="tile">
              <span className="tile-value">{counts[c.key] ?? '…'}</span>
              <span className="tile-label">{c.label}</span>
            </Link>
          ))}
        </section>
      )}

      <section className="card">
        <div className="card-header"><h2>Roadmap do projeto</h2></div>
        <ol className="roadmap">
          {roadmap.map((r) => (
            <li key={r.stage} className={r.status}>
              <span className="roadmap-stage">{r.stage}</span>
              <div>
                <strong>{r.title}</strong> <span className={`status ${r.status === 'done' ? 'ok' : r.status === 'next' ? 'warn' : 'off'}`}>{STATUS[r.status]}</span>
                <div className="hint">{r.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card note">
        <h2>O que é real e o que é simulado</h2>
        <ul>
          <li><strong>Implementado:</strong> login seguro, permissões e escopo por centro validados no backend, auditoria, estrutura organizacional, o módulo MM (compras, estoque, inventário e MRP simplificado) e o módulo SD (clientes, preços, pedido de venda com ATP e reserva, entrega com saída 601, faturamento com estorno e contas a receber), compartilhando o mesmo estoque.</li>
          <li><strong>Simulado:</strong> todo o ERP. Os conceitos seguem o SAP S/4HANA, mas o sistema é próprio e não se conecta a nenhum SAP. Impostos, envio ao fornecedor, MRP, ATP e pagamentos são simplificações didáticas (não há FI nem integração bancária).</li>
          <li><strong>Planejado:</strong> trilha completa de documentos compra → venda, n8n, assistente de IA e BI (ver roadmap).</li>
        </ul>
      </section>
    </>
  );
}
