import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, errorText, fmtDate, fmtMoney, fmtQty, today, useList } from '../../components/ui.jsx';
import { FlowLink } from '../DocumentFlow.jsx';

export default function Billing() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useList('/sd/billing', { type: '', status: '' });
  const [msg, setMsg] = useState('');
  const fromDelivery = params.get('entrega') ? Number(params.get('entrega')) : null;
  const openId = params.get('abrir') ? Number(params.get('abrir')) : null;
  const [creating, setCreating] = useState(!!fromDelivery);

  return (
    <>
      <div className="page-header">
        <h1>Faturamento</h1>
        <p className="hint">Inspirado no VF01/VF11. A fatura é emitida pela entrega com saída lançada e gera um título a receber. O estorno gera um documento de valores negativos: nada é apagado.</p>
      </div>
      <Alert ok={msg} error={list.error} />
      <section className="card">
        <div className="card-header">
          <div className="toolbar">
            <select aria-label="Tipo" value={list.filters.type} onChange={(e) => list.setFilter('type', e.target.value)}>
              <option value="">Faturas e estornos</option><option value="INVOICE">Faturas</option><option value="CANCELLATION">Estornos</option>
            </select>
            <select aria-label="Status" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
              <option value="">Todos</option><option value="ACTIVE">Ativos</option><option value="CANCELLED">Estornados</option>
            </select>
          </div>
          {can('SD.BILLING.CREATE') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Faturar entrega</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Documento</th><th>Tipo</th><th>Data</th><th>Cliente</th><th>Pedido</th><th>Entrega</th><th>Líquido</th><th>Imposto</th><th>Total</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={11} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={11} className="empty">Nenhum documento.</td></tr>}
              {list.data?.data.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.number}</strong></td><td>{b.type === 'INVOICE' ? 'Fatura' : 'Estorno'}</td><td>{fmtDate(b.billing_date)}</td><td>{b.customer_name}</td>
                  <td>{b.sales_order_number}</td><td>{b.delivery_number}</td><td>{fmtMoney(b.total_net, b.currency)}</td><td>{fmtMoney(b.total_tax, b.currency)}</td>
                  <td className={b.total_gross < 0 ? 'neg' : ''}><strong>{fmtMoney(b.total_gross, b.currency)}</strong></td>
                  <td><span className={`status ${b.status === 'ACTIVE' ? 'ok' : 'off'}`}>{b.status === 'ACTIVE' ? 'Ativo' : 'Estornado'}</span></td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setParams({ abrir: String(b.id) })}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </section>
      {creating && (
        <CreateBilling initialDelivery={fromDelivery} onClose={() => { setCreating(false); setParams({}); }}
          onSaved={(b) => { setCreating(false); setMsg(`Fatura ${b.number} emitida (${fmtMoney(b.total_gross, b.currency)}). Título a receber criado com vencimento em ${fmtDate(b.receivable?.due_date)}.`); list.reload(); setParams({ abrir: String(b.id) }); }} />
      )}
      {openId && <BillingDetail id={openId} onClose={() => setParams({})} onChanged={list.reload} onOpen={(i) => setParams({ abrir: String(i) })} />}
    </>
  );
}

function CreateBilling({ initialDelivery, onClose, onSaved }) {
  const [deliveries, setDeliveries] = useState([]);
  const [deliveryId, setDeliveryId] = useState(initialDelivery ?? '');
  const [date, setDate] = useState(today());
  const [err, setErr] = useState('');
  useEffect(() => { api('/sd/deliveries?pageSize=100&unbilled=true').then((r) => setDeliveries(r.data)).catch((e) => setErr(e.message)); }, []);
  async function save() {
    setErr('');
    try { onSaved((await api('/sd/billing', { method: 'POST', body: { delivery_id: deliveryId, billing_date: date } })).data); } catch (e) { setErr(errorText(e)); }
  }
  return (
    <Modal title="Faturar entrega" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!deliveryId} onClick={save}>Emitir fatura</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Entrega com saída lançada" required>
          <Select value={deliveryId} onChange={setDeliveryId} options={deliveries.map((d) => ({ value: d.id, label: `${d.number} – pedido ${d.sales_order_number} (${d.customer_name})` }))} />
        </Field>
        <Field label="Data da fatura" required><input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <p className="hint small">Os preços, descontos e impostos são os gravados no pedido de venda. O vencimento do título é a data da fatura mais o prazo da condição de pagamento.</p>
    </Modal>
  );
}

function BillingDetail({ id, onClose, onChanged, onOpen }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [b, setB] = useState(null);
  const [msg, setMsg] = useState({});
  useEffect(() => { api(`/sd/billing/${id}`).then((r) => setB(r.data)).catch((e) => setMsg({ error: e.message })); }, [id]);

  async function cancel() {
    const reason = window.prompt(`Motivo do estorno da fatura ${b.number}:`);
    if (!reason) return;
    try { const r = await api(`/sd/billing/${id}/cancel`, { method: 'POST', body: { reason } }); onChanged(); onOpen(r.data.id); }
    catch (e) { setMsg({ error: errorText(e) }); }
  }

  if (!b) return <Modal title="Faturamento" onClose={onClose}><Alert error={msg.error} />{!msg.error && 'Carregando…'}</Modal>;
  return (
    <Modal wide title={`${b.type === 'INVOICE' ? 'Fatura' : 'Estorno'} ${b.number}`} onClose={onClose}>
      <Alert error={msg.error} ok={msg.ok} />
      <p>
        <span className={`status ${b.status === 'ACTIVE' ? 'ok' : 'off'}`}>{b.status === 'ACTIVE' ? 'Ativo' : 'Estornado'}</span> · {fmtDate(b.billing_date)} · {b.customer_code} – {b.customer_name}
        {' '}· pedido <button className="link" onClick={() => navigate(`/sd/pedidos?abrir=${b.sales_order_id}`)}>{b.sales_order_number}</button> · entrega {b.delivery_number}
        {b.reference_number && <> · estorno da fatura <button className="link" onClick={() => onOpen(b.reference_billing_id)}>{b.reference_number}</button></>}
      </p>
      {b.reason && <div className="alert warn-box">Motivo: {b.reason}</div>}
      {b.cancellation && <div className="alert warn-box">Estornada pelo documento <button className="link" onClick={() => onOpen(b.cancellation.id)}>{b.cancellation.number}</button> em {fmtDate(b.cancellation.created_at)}.</div>}
      <table>
        <thead><tr><th>Item</th><th>Material</th><th>Qtd.</th><th>Preço</th><th>Desconto</th><th>Líquido</th><th>Imposto</th></tr></thead>
        <tbody>
          {b.items.map((i) => (
            <tr key={i.id}><td>{i.so_item_no}</td><td>{i.material_code} – {i.description}</td><td>{fmtQty(i.quantity, i.base_unit)}</td><td>{fmtMoney(i.unit_price)}</td><td>{fmtMoney(i.discount_amount)}</td><td>{fmtMoney(i.net_amount)}</td><td>{i.tax_rate}% = {fmtMoney(i.tax_amount)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="right">Líquido {fmtMoney(b.total_net, b.currency)} + impostos {fmtMoney(b.total_tax, b.currency)} = <strong>{fmtMoney(b.total_gross, b.currency)}</strong></p>
      {b.receivable && (
        <p>Título a receber: {fmtMoney(b.receivable.amount)} · pago {fmtMoney(b.receivable.paid_amount)} · vence {fmtDate(b.receivable.due_date)} · {b.receivable.status}
          {' '}<button className="link" onClick={() => navigate(`/sd/contas-a-receber?abrir=${b.receivable.id}`)}>abrir título</button></p>
      )}
      <div className="row-actions">
        <FlowLink type="BILLING" id={b.id} />
        {b.type === 'INVOICE' && b.status === 'ACTIVE' && can('SD.BILLING.CANCEL') && <button className="btn btn-small btn-danger" onClick={cancel}>Estornar fatura</button>}
      </div>
    </Modal>
  );
}
