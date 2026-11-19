import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, Status, errorText, fmtDate, fmtQty, useList, useLookup } from '../../components/ui.jsx';

export default function GoodsReceipts() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useList('/mm/goods-receipts', { plant_id: '' });
  const plants = useLookup('/org/plants?pageSize=100');
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState('');
  const poToReceive = params.get('pedido') ? Number(params.get('pedido')) : null;
  const [receiving, setReceiving] = useState(!!poToReceive);

  return (
    <>
      <div className="page-header">
        <h1>Recebimento de mercadorias</h1>
        <p className="hint">Entrada com referência a pedido de compra (movimento 101, inspirado no MIGO). Cada recebimento gera um documento de material.</p>
      </div>
      <Alert ok={msg} error={list.error} />
      <section className="card">
        <div className="card-header">
          <div className="toolbar">
            <select aria-label="Centro" value={list.filters.plant_id} onChange={(e) => list.setFilter('plant_id', e.target.value)}>
              <option value="">Todos os centros</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </select>
          </div>
          {can('MM.GOODS_RECEIPT.POST') && <button className="btn btn-primary" onClick={() => setReceiving(true)}>+ Registrar recebimento</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Documento</th><th>Pedido</th><th>Fornecedor</th><th>Centro</th><th>Linhas</th><th>Lançado em</th><th>Por</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={8} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={8} className="empty">Nenhum recebimento.</td></tr>}
              {list.data?.data.map((g) => (
                <tr key={g.id}>
                  <td><strong>{g.doc_number}</strong></td><td>{g.purchase_order_number}</td><td>{g.supplier_name}</td><td>{g.plant_code}</td>
                  <td>{g.line_count}</td><td className="nowrap">{fmtDate(g.posted_at)}</td><td>{g.posted_by_username}</td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setOpenId(g.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </section>
      {receiving && (
        <ReceiveForm initialPo={poToReceive} onClose={() => { setReceiving(false); setParams({}); }}
          onSaved={(r) => { setReceiving(false); setParams({}); setMsg(`Recebimento lançado: documento ${r.doc_number}. Pedido ${r.purchase_order_number} agora está ${r.purchase_order_status}.`); list.reload(); }} />
      )}
      {openId && <ReceiptDetail id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ReceiveForm({ initialPo, onClose, onSaved }) {
  const { can } = useAuth();
  const [orders, setOrders] = useState([]);
  const [poId, setPoId] = useState(initialPo ?? '');
  const [po, setPo] = useState(null);
  const [qtys, setQtys] = useState({});
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { api('/mm/purchase-orders?pageSize=100&open_for_receipt=true').then((r) => setOrders(r.data)).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if (!poId) { setPo(null); return; }
    api(`/mm/purchase-orders/${poId}`).then((r) => { setPo(r.data); setQtys(Object.fromEntries(r.data.items.map((i) => [i.id, i.open_qty]))); }).catch((e) => setErr(e.message));
  }, [poId]);

  async function save() {
    setErr('');
    const items = Object.entries(qtys).filter(([, q]) => Number(q) > 0).map(([id, quantity]) => ({ purchase_order_item_id: Number(id), quantity }));
    try { onSaved((await api('/mm/goods-receipts', { method: 'POST', body: { purchase_order_id: poId, notes, items } })).data); }
    catch (e) { setErr(errorText(e)); }
  }

  return (
    <Modal wide title="Registrar recebimento" onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!po} onClick={save}>Lançar recebimento</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Pedido de compra" required hint="Pedidos aprovados, enviados ou parcialmente recebidos">
          <Select value={poId} onChange={setPoId} options={orders.map((o) => ({ value: o.id, label: `${o.number} – ${o.supplier_name} (${o.plant_code})` }))} />
        </Field>
        <Field label="Observação (nota fiscal, transportadora…)"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {po && (
        <>
          <p className="hint">
            <Status value={po.status} /> · tolerância de excesso do fornecedor: {po.overdelivery_tolerance_pct}%
            {can('MM.GOODS_RECEIPT.OVERDELIVERY') ? ' (você pode usar)' : ' (exige permissão MM.GOODS_RECEIPT.OVERDELIVERY)'}
          </p>
          <table>
            <thead><tr><th>Item</th><th>Material</th><th>Depósito</th><th>Pedido</th><th>Já recebido</th><th>Pendente</th><th>Receber agora</th></tr></thead>
            <tbody>
              {po.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.item_no}</td><td>{i.material_code} – {i.description}</td><td>{i.sloc_code}</td><td>{fmtQty(i.quantity, i.base_unit)}</td>
                  <td>{fmtQty(i.received_qty)}</td><td>{fmtQty(i.open_qty)}</td>
                  <td><input type="number" min="0" step="0.001" className="input-qty" value={qtys[i.id] ?? 0} onChange={(e) => setQtys({ ...qtys, [i.id]: e.target.value })} aria-label={`Receber agora do item ${i.item_no}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint small">Deixe 0 nos itens que não chegaram. Recebimento parcial mantém o pedido aberto.</p>
        </>
      )}
    </Modal>
  );
}

function ReceiptDetail({ id, onClose }) {
  const navigate = useNavigate();
  const [g, setG] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/mm/goods-receipts/${id}`).then((r) => setG(r.data)).catch((e) => setErr(e.message)); }, [id]);
  if (!g) return <Modal title="Recebimento" onClose={onClose}><Alert error={err} />{!err && 'Carregando…'}</Modal>;
  return (
    <Modal wide title={`Documento de material ${g.doc_number}`} onClose={onClose}>
      <p>
        Pedido <button className="link" onClick={() => navigate(`/mm/pedidos?abrir=${g.purchase_order_id}`)}>{g.purchase_order_number}</button> <Status value={g.purchase_order_status} />
        {' '}· lançado em {fmtDate(g.posted_at)}{g.notes ? ` · ${g.notes}` : ''}
      </p>
      <table>
        <thead><tr><th>Linha</th><th>Item do pedido</th><th>Material</th><th>Depósito</th><th>Quantidade</th></tr></thead>
        <tbody>{g.lines.map((l) => <tr key={l.line_no}><td>{l.line_no}</td><td>{l.po_item_no}</td><td>{l.material_code} – {l.description}</td><td>{l.sloc_code}</td><td>{fmtQty(l.quantity, l.base_unit)}</td></tr>)}</tbody>
      </table>
    </Modal>
  );
}
