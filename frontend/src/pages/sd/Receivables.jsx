import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, errorText, fmtDate, fmtMoney, today, useList } from '../../components/ui.jsx';

const AR = { OPEN: ['Em aberto', 'warn'], PARTIALLY_PAID: ['Pago parcialmente', 'warn'], PAID: ['Quitado', 'ok'], CANCELLED: ['Cancelado', 'off'] };
const ArStatus = ({ value, overdue }) => (overdue ? <span className="status bad">Atrasado</span> : <span className={`status ${AR[value][1]}`}>{AR[value][0]}</span>);

export default function Receivables() {
  const [params, setParams] = useSearchParams();
  const list = useList('/sd/receivables', { status: '', overdue: '', open: 'true' }, 50);
  const openId = params.get('abrir') ? Number(params.get('abrir')) : null;

  return (
    <>
      <div className="page-header">
        <h1>Contas a receber (simulado)</h1>
        <p className="hint">Um título por fatura. O pagamento é simulado: não há integração bancária nem contabilidade, e isto <strong>não</strong> é um módulo FI.</p>
      </div>
      <Alert error={list.error} />
      <section className="card">
        <div className="toolbar">
          <label className="checkbox"><input type="checkbox" checked={list.filters.open === 'true'} onChange={(e) => list.setFilter('open', e.target.checked ? 'true' : '')} /> Só em aberto</label>
          <label className="checkbox"><input type="checkbox" checked={list.filters.overdue === 'true'} onChange={(e) => list.setFilter('overdue', e.target.checked ? 'true' : '')} /> Só atrasados</label>
          <select aria-label="Status" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
            <option value="">Todos os status</option>{Object.entries(AR).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {list.data && <span className="toolbar-count">Saldo em aberto: <strong>{fmtMoney(list.data.meta.open_total)}</strong></span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fatura</th><th>Cliente</th><th>Pedido</th><th>Emissão</th><th>Vencimento</th><th>Valor</th><th>Pago</th><th>Em aberto</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={10} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={10} className="empty">Nenhum título.</td></tr>}
              {list.data?.data.map((r) => (
                <tr key={r.id} className={r.overdue ? 'row-warn' : ''}>
                  <td><strong>{r.billing_number}</strong></td><td>{r.customer_code} – {r.customer_name}</td><td>{r.sales_order_number}</td>
                  <td>{fmtDate(r.issue_date)}</td><td>{fmtDate(r.due_date)}</td><td>{fmtMoney(r.amount, r.currency)}</td><td>{fmtMoney(r.paid_amount, r.currency)}</td>
                  <td><strong>{fmtMoney(r.open_amount, r.currency)}</strong></td><td><ArStatus value={r.status} overdue={r.overdue} /></td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setParams({ abrir: String(r.id) })}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </section>
      {openId && <ReceivableDetail id={openId} onClose={() => setParams({})} onChanged={list.reload} />}
    </>
  );
}

function ReceivableDetail({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [r, setR] = useState(null);
  const [f, setF] = useState({ amount: '', payment_date: today(), method: 'PIX', notes: '' });
  const [msg, setMsg] = useState({});
  const reload = () => api(`/sd/receivables/${id}`).then((x) => { setR(x.data); setF((p) => ({ ...p, amount: x.data.open_amount })); }).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { reload(); }, [id]);

  async function pay() {
    if (!window.confirm(`Registrar pagamento de ${fmtMoney(f.amount)} (${f.method})?`)) return;
    try {
      const x = await api(`/sd/receivables/${id}/payments`, { method: 'POST', body: f });
      setMsg({ ok: `Pagamento ${x.data.payment_number} registrado. ${x.data.status === 'PAID' ? 'Título quitado.' : `Em aberto: ${fmtMoney(x.data.open_amount)}.`}` });
      reload(); onChanged();
    } catch (e) { setMsg({ error: errorText(e) }); }
  }

  if (!r) return <Modal title="Título" onClose={onClose}><Alert error={msg.error} />{!msg.error && 'Carregando…'}</Modal>;
  return (
    <Modal wide title={`Título da fatura ${r.billing_number}`} onClose={onClose}>
      <Alert error={msg.error} ok={msg.ok} />
      <p>
        <ArStatus value={r.status} overdue={r.overdue} /> · {r.customer_code} – {r.customer_name} · pedido <button className="link" onClick={() => navigate(`/sd/pedidos?abrir=${r.sales_order_id}`)}>{r.sales_order_number}</button>
        {' '}· emissão {fmtDate(r.issue_date)} · vencimento <strong>{fmtDate(r.due_date)}</strong>
      </p>
      <p>Valor {fmtMoney(r.amount, r.currency)} · pago {fmtMoney(r.paid_amount, r.currency)} · <strong>em aberto {fmtMoney(r.open_amount, r.currency)}</strong></p>
      <h4>Pagamentos</h4>
      <table>
        <thead><tr><th>Documento</th><th>Data</th><th>Forma</th><th>Valor</th><th>Registrado por</th><th>Observação</th></tr></thead>
        <tbody>
          {r.payments.length === 0 && <tr><td colSpan={6} className="empty">Nenhum pagamento.</td></tr>}
          {r.payments.map((p) => <tr key={p.id}><td>{p.number}</td><td>{fmtDate(p.payment_date)}</td><td>{p.method}</td><td>{fmtMoney(p.amount, r.currency)}</td><td>{p.created_by_username}</td><td>{p.notes ?? '—'}</td></tr>)}
        </tbody>
      </table>
      {['OPEN', 'PARTIALLY_PAID'].includes(r.status) && can('SD.PAYMENT.POST') && (
        <>
          <h4>Registrar pagamento (simulado)</h4>
          <div className="form-grid compact">
            <Field label="Valor (R$)" required><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Data" required><input type="date" max={today()} value={f.payment_date} onChange={(e) => setF({ ...f, payment_date: e.target.value })} /></Field>
            <Field label="Forma" required><Select value={f.method} onChange={(v) => setF({ ...f, method: v })} options={[{ value: 'PIX', label: 'PIX' }, { value: 'BOLETO', label: 'Boleto' }, { value: 'TRANSFER', label: 'Transferência' }]} /></Field>
            <Field label="Observação"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            <div className="field field-button"><button className="btn btn-small btn-primary" onClick={pay}>Registrar</button></div>
          </div>
        </>
      )}
    </Modal>
  );
}
