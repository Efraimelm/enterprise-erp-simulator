import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, errorText, fmtDate, fmtMoney, fmtQty, useList, useLookup } from '../../components/ui.jsx';
import { FlowLink } from '../DocumentFlow.jsx';

const D_LABEL = { CREATED: ['Criada', 'warn'], PICKED: ['Separada', 'warn'], POSTED: ['Saída lançada', 'ok'] };
const DStatus = ({ value }) => { const [l, c] = D_LABEL[value]; return <span className={`status ${c}`}>{l}</span>; };

export default function Deliveries() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useList('/sd/deliveries', { status: '', plant_id: '' });
  const plants = useLookup('/org/plants?pageSize=100');
  const [msg, setMsg] = useState('');
  const fromOrder = params.get('pedido') ? Number(params.get('pedido')) : null;
  const openId = params.get('abrir') ? Number(params.get('abrir')) : null;
  const [creating, setCreating] = useState(!!fromOrder);

  return (
    <>
      <div className="page-header">
        <h1>Entregas</h1>
        <p className="hint">Inspirado no VL01N. Criar → separar (picking simulado) → lançar a saída de mercadoria (movimento 601), que baixa o estoque e a reserva.</p>
      </div>
      <Alert ok={msg} error={list.error} />
      <section className="card">
        <div className="card-header">
          <div className="toolbar">
            <select aria-label="Centro" value={list.filters.plant_id} onChange={(e) => list.setFilter('plant_id', e.target.value)}>
              <option value="">Todos os centros</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </select>
            <select aria-label="Status" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
              <option value="">Todos os status</option>{Object.entries(D_LABEL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {can('SD.DELIVERY.CREATE') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nova entrega</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Entrega</th><th>Pedido</th><th>Cliente</th><th>Centro</th><th>Quantidade</th><th>Criada em</th><th>Saída</th><th>Fatura</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={10} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={10} className="empty">Nenhuma entrega.</td></tr>}
              {list.data?.data.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.number}</strong></td><td>{d.sales_order_number}</td><td>{d.customer_name}</td><td>{d.plant_code}</td><td>{fmtQty(d.total_qty)}</td>
                  <td className="nowrap">{fmtDate(d.created_at)}</td><td>{d.material_doc_number ?? '—'}</td><td>{d.billing_number ?? '—'}</td><td><DStatus value={d.status} /></td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setParams({ abrir: String(d.id) })}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </section>
      {creating && (
        <CreateDelivery initialOrder={fromOrder} onClose={() => { setCreating(false); setParams({}); }}
          onSaved={(d) => { setCreating(false); setMsg(`Entrega ${d.number} criada. Próximo passo: separar.`); list.reload(); setParams({ abrir: String(d.id) }); }} />
      )}
      {openId && <DeliveryDetail id={openId} onClose={() => setParams({})} onChanged={list.reload} />}
    </>
  );
}

function CreateDelivery({ initialOrder, onClose, onSaved }) {
  const [orders, setOrders] = useState([]);
  const [soId, setSoId] = useState(initialOrder ?? '');
  const [so, setSo] = useState(null);
  const [qtys, setQtys] = useState({});
  const [err, setErr] = useState('');
  useEffect(() => { api('/sd/sales-orders?pageSize=100&deliverable=true').then((r) => setOrders(r.data)).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if (!soId) return setSo(null);
    api(`/sd/sales-orders/${soId}`).then((r) => { setSo(r.data); setQtys(Object.fromEntries(r.data.items.map((i) => [i.id, i.deliverable_qty]))); }).catch((e) => setErr(e.message));
  }, [soId]);

  async function save() {
    setErr('');
    const items = Object.entries(qtys).filter(([, q]) => Number(q) > 0).map(([id, quantity]) => ({ sales_order_item_id: Number(id), quantity }));
    try { onSaved((await api('/sd/deliveries', { method: 'POST', body: { sales_order_id: soId, items } })).data); } catch (e) { setErr(errorText(e)); }
  }

  return (
    <Modal wide title="Nova entrega" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!so} onClick={save}>Criar entrega</button></>}>
      <Alert error={err} />
      <Field label="Pedido de venda (confirmado)" required>
        <Select value={soId} onChange={setSoId} options={orders.map((o) => ({ value: o.id, label: `${o.number} – ${o.customer_name} (${o.plant_code})` }))} />
      </Field>
      {so && (
        <table>
          <thead><tr><th>Item</th><th>Material</th><th>Confirmado</th><th>Entregue</th><th>Em entrega</th><th>Pode entregar</th><th>Entregar agora</th></tr></thead>
          <tbody>
            {so.items.map((i) => (
              <tr key={i.id}>
                <td>{i.item_no}</td><td>{i.material_code} – {i.description}</td><td>{fmtQty(i.confirmed_qty, i.base_unit)}</td><td>{fmtQty(i.delivered_qty)}</td>
                <td>{fmtQty(i.in_delivery_qty)}</td><td>{fmtQty(i.deliverable_qty)}</td>
                <td><input type="number" min="0" step="0.001" className="input-qty" value={qtys[i.id] ?? 0} onChange={(e) => setQtys({ ...qtys, [i.id]: e.target.value })} aria-label={`Entregar agora do item ${i.item_no}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint small">Só é possível entregar o que foi confirmado (reservado) e ainda não está em outra entrega.</p>
    </Modal>
  );
}

function DeliveryDetail({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [picked, setPicked] = useState({});
  const [msg, setMsg] = useState({});
  const load = (data) => { setD(data); setPicked(Object.fromEntries(data.items.map((i) => [i.id, i.picked_qty ?? i.quantity]))); };
  useEffect(() => { api(`/sd/deliveries/${id}`).then((r) => load(r.data)).catch((e) => setMsg({ error: e.message })); }, [id]);

  async function run(fn, ok) {
    try { const r = await fn(); if (r) load(r.data); setMsg({ ok }); onChanged(); } catch (e) { setMsg({ error: errorText(e) }); }
  }

  if (!d) return <Modal title="Entrega" onClose={onClose}><Alert error={msg.error} />{!msg.error && 'Carregando…'}</Modal>;
  const editable = can('SD.DELIVERY.CREATE') && d.status !== 'POSTED';

  return (
    <Modal wide title={`Entrega ${d.number}`} onClose={onClose}>
      <Alert error={msg.error} ok={msg.ok} />
      <p>
        <DStatus value={d.status} /> · pedido <button className="link" onClick={() => navigate(`/sd/pedidos?abrir=${d.sales_order_id}`)}>{d.sales_order_number}</button>
        {' '}· {d.customer_code} – {d.customer_name} · centro {d.plant_code}{d.ship_to && ` · entregar em: ${d.ship_to}`}
      </p>
      <p className="hint small">
        Criada por {d.created_by_username} em {fmtDate(d.created_at)}
        {d.picked_by_username && ` · separada por ${d.picked_by_username} em ${fmtDate(d.picked_at)}`}
        {d.posted_by_username && ` · saída lançada por ${d.posted_by_username} em ${fmtDate(d.posted_at)} (documento de material ${d.material_doc_number})`}
      </p>
      <table>
        <thead><tr><th>Item do pedido</th><th>Material</th><th>Depósito</th><th>Na entrega</th><th>Separado</th></tr></thead>
        <tbody>
          {d.items.map((i) => (
            <tr key={i.id}>
              <td>{i.so_item_no}</td><td>{i.material_code} – {i.description}</td><td>{i.sloc_code}</td><td>{fmtQty(i.quantity, i.base_unit)}</td>
              <td>{editable
                ? <input type="number" min="0" step="0.001" className="input-qty" value={picked[i.id]} onChange={(e) => setPicked({ ...picked, [i.id]: e.target.value })} aria-label={`Separado do item ${i.so_item_no}`} />
                : fmtQty(i.picked_qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-actions">
        <FlowLink type="DELIVERY" id={d.id} />
        {editable && <button className="btn btn-small" onClick={() => run(() => api(`/sd/deliveries/${id}/pick`, { method: 'POST', body: { items: d.items.map((i) => ({ delivery_item_id: i.id, picked_qty: picked[i.id] })) } }), 'Separação registrada.')}>1. Confirmar separação</button>}
        {d.status === 'PICKED' && can('SD.DELIVERY.CREATE') && (
          <button className="btn btn-small btn-primary" onClick={() => window.confirm('Lançar a saída de mercadoria? O estoque será baixado (movimento 601).') && run(() => api(`/sd/deliveries/${id}/post-goods-issue`, { method: 'POST' }), 'Saída de mercadoria lançada.')}>2. Lançar saída de mercadoria</button>
        )}
        {d.status === 'POSTED' && can('SD.BILLING.CREATE') && !d.billing.some((b) => b.type === 'INVOICE' && b.status === 'ACTIVE') && (
          <button className="btn btn-small btn-primary" onClick={() => navigate(`/sd/faturamento?entrega=${d.id}`)}>3. Faturar</button>
        )}
        {editable && <button className="btn btn-small btn-danger" onClick={() => window.confirm(`Excluir a entrega ${d.number}? A reserva continua no pedido.`) && run(async () => { await api(`/sd/deliveries/${id}`, { method: 'DELETE' }); onClose(); }, 'Entrega excluída.')}>Excluir entrega</button>}
      </div>
      {d.billing.length > 0 && (
        <p>Faturamento: {d.billing.map((b) => <span key={b.id} className="chip">{b.type === 'INVOICE' ? 'Fatura' : 'Estorno'} {b.number} · {fmtMoney(b.total_gross)} · {b.status}</span>)}</p>
      )}
    </Modal>
  );
}
