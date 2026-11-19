// Trilha de documentos de ponta a ponta: compras → estoque → vendas → financeiro.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Alert, fmtDate, fmtMoney } from '../components/ui.jsx';

const STAGES = ['Compras', 'Estoque', 'Vendas', 'Financeiro'];
const TYPE_ORDER = ['PURCHASE_REQ', 'PURCHASE_ORDER', 'MATERIAL_DOC', 'SALES_ORDER', 'DELIVERY', 'BILLING', 'RECEIVABLE', 'PAYMENT'];
const STATUS_PT = {
  PENDING_APPROVAL: 'aguardando aprovação', APPROVED: 'aprovado', CONVERTED: 'convertida', REJECTED: 'rejeitada', CANCELLED: 'cancelado',
  DRAFT: 'rascunho', SENT: 'enviado', PARTIALLY_RECEIVED: 'parcialmente recebido', RECEIVED: 'recebido', CONFIRMED: 'confirmado',
  IN_DELIVERY: 'em entrega', PARTIALLY_DELIVERED: 'parcialmente entregue', DELIVERED: 'entregue', BILLED: 'faturado',
  CREATED: 'criada', PICKED: 'separada', POSTED: 'saída lançada', ACTIVE: 'ativo', OPEN: 'em aberto', PARTIALLY_PAID: 'pago parcialmente', PAID: 'quitado',
};
const OPEN_LINK = {
  PURCHASE_REQ: (id) => `/mm/requisicoes?abrir=${id}`,
  PURCHASE_ORDER: (id) => `/mm/pedidos?abrir=${id}`,
  SALES_ORDER: (id) => `/sd/pedidos?abrir=${id}`,
  DELIVERY: (id) => `/sd/entregas?abrir=${id}`,
  BILLING: (id) => `/sd/faturamento?abrir=${id}`,
  RECEIVABLE: (id) => `/sd/contas-a-receber?abrir=${id}`,
};

export default function DocumentFlow() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const type = params.get('tipo');
  const id = params.get('id');
  const [flow, setFlow] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!type || !id) return;
    setFlow(null); setError('');
    api(`/flow/${type}/${encodeURIComponent(id)}`).then((r) => setFlow(r.data)).catch((e) => setError(e.message));
  }, [type, id]);

  async function search(e) {
    e.preventDefault();
    setError('');
    try {
      const r = await api(`/flow/search?q=${encodeURIComponent(q.trim())}`);
      if (r.data.length === 1) { setResults(null); setParams({ tipo: r.data[0].type, id: String(r.data[0].id) }); } else setResults(r.data);
    } catch (err) { setError(err.message); }
  }

  const byKey = useMemo(() => new Map(flow?.nodes.map((n) => [n.key, n]) ?? []), [flow]);
  const lanes = useMemo(() => STAGES.map((s) => ({
    stage: s,
    // Ordem do processo dentro da coluna (RC antes de PC, pedido antes de entrega…) e, depois, por data.
    nodes: (flow?.nodes ?? []).filter((n) => n.stage === s)
      .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number))),
  })), [flow]);

  return (
    <>
      <div className="page-header">
        <h1>Fluxo de documentos</h1>
        <p className="hint">
          Trilha de ponta a ponta: de onde cada documento veio e para onde foi. Compra e venda se ligam pelo estoque:
          cada saída é atribuída às entradas mais antigas do mesmo material e depósito (<strong>FIFO simulado</strong>, sem controle de lote).
        </p>
      </div>
      <section className="card">
        <form className="toolbar" onSubmit={search}>
          <input type="search" inputMode="numeric" placeholder="Número de qualquer documento (ex.: 4500000001)" aria-label="Número do documento" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-primary" disabled={!q.trim()}>Buscar</button>
        </form>
        {results && (
          results.length === 0 ? <p className="hint">Nenhum documento encontrado (ou fora do seu escopo/permissão).</p> : (
            <ul className="search-results">
              {results.map((r) => (
                <li key={`${r.type}:${r.id}`}><button className="link" onClick={() => { setResults(null); setParams({ tipo: r.type, id: String(r.id) }); }}>{r.typeLabel} {r.number}</button></li>
              ))}
            </ul>
          )
        )}
      </section>
      <Alert error={error} />
      {!type && !error && <p className="hint">Busque um número acima, ou abra a trilha a partir de um pedido, entrega ou fatura.</p>}
      {type && !flow && !error && <div className="empty" role="status">Montando a trilha…</div>}
      {flow && (
        <>
          <p className="hint">
            {flow.nodes.length} documento(s) relacionados
            {flow.hidden > 0 && <> · <strong>{flow.hidden} oculto(s)</strong> por permissão ou escopo</>}
            {flow.truncated && <> · trilha <strong>truncada</strong> em 150 documentos</>}
          </p>
          <div className="flow-lanes">
            {lanes.map((lane) => (
              <section key={lane.stage} className="flow-lane" aria-label={lane.stage}>
                <h2>{lane.stage}</h2>
                {lane.nodes.length === 0 && <p className="hint small">—</p>}
                {lane.nodes.map((n) => (
                  <FlowCard key={n.key} node={n} root={n.key === flow.root} edges={flow.edges} byKey={byKey}
                    onFocus={() => setParams({ tipo: n.type, id: String(n.id) })}
                    onOpen={OPEN_LINK[n.type] ? () => navigate(OPEN_LINK[n.type](n.id)) : null} />
                ))}
              </section>
            ))}
          </div>
          <p className="hint small">{flow.note}</p>
        </>
      )}
    </>
  );
}

function FlowCard({ node, root, edges, byKey, onFocus, onOpen }) {
  const incoming = edges.filter((e) => e.to === node.key);
  const outgoing = edges.filter((e) => e.from === node.key);
  const ref = (k) => { const n = byKey.get(k); return n ? `${n.typeLabel} ${n.number}` : k; };
  return (
    <article className={`flow-card ${root ? 'root' : ''}`} aria-current={root ? 'true' : undefined}>
      <div className="flow-card-head">
        <span className="hint small">{node.typeLabel}</span>
        <strong>{node.number}</strong>
      </div>
      <div className="small">
        {node.status && <span className="chip">{STATUS_PT[node.status] ?? node.status}</span>}
        {node.plant_code && <span className="chip">{node.plant_code}</span>}
        {node.amount != null && <span className="chip">{fmtMoney(node.amount, node.currency ?? 'BRL')}</span>}
      </div>
      {node.subtitle && <div className="hint small">{node.subtitle}</div>}
      {node.summary && <ul className="flow-lines">{node.summary.slice(0, 4).map((s) => <li key={s}>{s}</li>)}{node.summary.length > 4 && <li>…</li>}</ul>}
      <div className="hint small">{fmtDate(node.date)}</div>
      {incoming.length > 0 && <ul className="flow-edges in">{incoming.map((e) => <li key={e.from}>← {ref(e.from)}: <em>{e.label}</em></li>)}</ul>}
      {outgoing.length > 0 && <ul className="flow-edges out">{outgoing.map((e) => <li key={e.to}>→ {ref(e.to)}: <em>{e.label}</em></li>)}</ul>}
      <div className="row-actions">
        {!root && <button className="btn btn-small" onClick={onFocus}>Centralizar aqui</button>}
        {onOpen && <button className="btn btn-small" onClick={onOpen}>Abrir</button>}
      </div>
    </article>
  );
}

/** Link "Ver trilha completa" usado nas telas de documentos. */
export function FlowLink({ type, id }) {
  return <Link className="btn btn-small" to={`/fluxo?tipo=${type}&id=${id}`}>Ver trilha completa</Link>;
}
