import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import ItemsEditor, { itemsPayload } from '../../components/ItemsEditor.jsx';
import { Alert, Field, Modal, Pager, Select, Status, codeName, errorText, fmtDate, fmtMoney, fmtQty, today, useList, useLookup } from '../../components/ui.jsx';
import { History } from './Materials.jsx';

export default function Requisitions() {
  const { can } = useAuth();
  const list = useList('/mm/purchase-requisitions', { status: '', plant_id: '', source: '', q: '' });
  const plants = useLookup('/org/plants?pageSize=100');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState('');

  return (
    <>
      <div className="page-header">
        <h1>Requisições de compra</h1>
        <p className="hint">Pedido interno de compra (inspirado no ME51N). Quem solicita não aprova a própria requisição.</p>
      </div>
      <Alert ok={msg} error={list.error} />
      <section className="card">
        <div className="card-header">
          <div className="toolbar">
            <input type="search" placeholder="Número" aria-label="Número" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
            <select aria-label="Centro" value={list.filters.plant_id} onChange={(e) => list.setFilter('plant_id', e.target.value)}>
              <option value="">Todos os centros</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </select>
            <select aria-label="Status" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
              <option value="">Todos os status</option>
              {['PENDING_APPROVAL', 'APPROVED', 'CONVERTED', 'REJECTED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select aria-label="Origem" value={list.filters.source} onChange={(e) => list.setFilter('source', e.target.value)}>
              <option value="">Manual e MRP</option><option value="MANUAL">Manual</option><option value="MRP">MRP</option>
            </select>
          </div>
          {can('MM.PURCHASE_REQ.CREATE') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nova requisição</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Número</th><th>Centro</th><th>Solicitante</th><th>Origem</th><th>Itens</th><th>Valor estimado</th><th>Criada em</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={9} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={9} className="empty">Nenhuma requisição.</td></tr>}
              {list.data?.data.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.number}</strong></td><td>{r.plant_code}</td><td>{r.requester}</td><td>{r.source}</td><td>{r.item_count}</td>
                  <td className="nowrap">{fmtMoney(r.estimated_total)}</td><td className="nowrap">{fmtDate(r.created_at)}</td><td><Status value={r.status} /></td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setOpenId(r.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </section>
      {creating && <NewRequisition onClose={() => setCreating(false)} onSaved={(r) => { setCreating(false); setMsg(`Requisição ${r.number} criada e enviada para aprovação.`); list.reload(); setOpenId(r.id); }} />}
      {openId && <RequisitionDetail id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  );
}

function NewRequisition({ onClose, onSaved }) {
  const plants = useLookup('/org/plants?pageSize=100');
  const [plantId, setPlantId] = useState('');
  const [justification, setJustification] = useState('');
  const [items, setItems] = useState([{ material_id: '', quantity: '', storage_location_id: '', need_date: today(7) }]);
  const [err, setErr] = useState('');
  const materials = useLookup(`/mm/materials?pageSize=100&status=ACTIVE&plant_id=${plantId || ''}`);
  const slocs = useLookup(`/org/storage-locations?pageSize=100&plant_id=${plantId || 0}`);

  async function save() {
    setErr('');
    try {
      const r = await api('/mm/purchase-requisitions', { method: 'POST', body: { plant_id: plantId, justification, items: itemsPayload(items, { needDate: true }) } });
      onSaved(r.data);
    } catch (e) { setErr(errorText(e)); }
  }

  return (
    <Modal wide title="Nova requisição de compra" onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Criar e enviar para aprovação</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Centro" required><Select value={plantId} onChange={(v) => { setPlantId(v); setItems(items.map((i) => ({ ...i, material_id: '', storage_location_id: '' }))); }} options={plants.map(codeName)} /></Field>
        <Field label="Justificativa" required><input value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Por que comprar?" /></Field>
      </div>
      {plantId ? <ItemsEditor items={items} onChange={setItems} materials={materials} slocs={slocs} columns={{ needDate: today(7) }} /> : <p className="hint">Escolha o centro para listar os materiais cadastrados nele.</p>}
    </Modal>
  );
}

function RequisitionDetail({ id, onClose, onChanged }) {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [r, setR] = useState(null);
  const [msg, setMsg] = useState({});
  const [converting, setConverting] = useState(false);
  const reload = () => api(`/mm/purchase-requisitions/${id}`).then((x) => setR(x.data)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { reload(); }, [id]);

  async function act(path, body, ok) {
    try { const x = await api(`/mm/purchase-requisitions/${id}/${path}`, { method: 'POST', body }); setR(x.data); setMsg({ ok }); onChanged(); }
    catch (e) { setMsg({ error: errorText(e) }); }
  }
  const withReason = (path, label) => { const reason = window.prompt(`Motivo para ${label}:`); if (reason) act(path, { reason }, `Requisição: ${label} feito.`); };

  if (!r) return <Modal title="Requisição" onClose={onClose}><Alert error={msg.error} />{!msg.error && 'Carregando…'}</Modal>;
  const isRequester = r.requester_id === user.id;
  const canDecide = can('MM.PURCHASE_REQ.APPROVE') && r.status === 'PENDING_APPROVAL';

  return (
    <Modal wide title={`Requisição ${r.number}`} onClose={onClose}>
      <Alert error={msg.error} ok={msg.ok} />
      <p><Status value={r.status} /> · centro {r.plant_code} · solicitante {r.requester_name} · origem {r.source} · {fmtDate(r.created_at)}</p>
      <p><strong>Justificativa:</strong> {r.justification}</p>
      {r.decided_by_username && <p className="hint">Decisão por {r.decided_by_username} em {fmtDate(r.decided_at)}{r.decision_note ? ` — ${r.decision_note}` : ''}</p>}
      <div className="row-actions">
        {canDecide && !isRequester && <button className="btn btn-small btn-primary" onClick={() => act('approve', undefined, 'Requisição aprovada.')}>Aprovar</button>}
        {canDecide && !isRequester && <button className="btn btn-small btn-danger" onClick={() => withReason('reject', 'rejeitar')}>Rejeitar</button>}
        {canDecide && isRequester && <span className="hint">Você é o solicitante: outra pessoa precisa aprovar.</span>}
        {['PENDING_APPROVAL', 'APPROVED'].includes(r.status) && (isRequester || can('MM.PURCHASE_REQ.APPROVE')) && <button className="btn btn-small btn-danger" onClick={() => withReason('cancel', 'cancelar')}>Cancelar</button>}
        {r.status === 'APPROVED' && can('MM.PURCHASE_ORDER.CREATE') && <button className="btn btn-small btn-primary" onClick={() => setConverting(true)}>Converter em pedido</button>}
      </div>
      <table>
        <thead><tr><th>Item</th><th>Material</th><th>Quantidade</th><th>Depósito</th><th>Necessidade</th><th>Preço estimado</th><th>Pedido</th></tr></thead>
        <tbody>
          {r.items.map((i) => (
            <tr key={i.id}>
              <td>{i.item_no}</td><td>{i.material_code} – {i.description}</td><td>{fmtQty(i.quantity, i.base_unit)}</td><td>{i.sloc_code ?? '—'}</td>
              <td>{fmtDate(i.need_date)}</td><td>{fmtMoney(i.estimated_price)}</td>
              <td>{i.purchase_order_number ? <button className="link" onClick={() => navigate(`/mm/pedidos?abrir=${i.purchase_order_id}`)}>{i.purchase_order_number}</button> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="right"><strong>Total estimado: {fmtMoney(r.estimated_total)}</strong></p>
      {converting && <ConvertToOrder requisition={r} onClose={() => setConverting(false)} onDone={(po) => { setConverting(false); onChanged(); navigate(`/mm/pedidos?abrir=${po.id}`); }} />}
      <History items={r.history} />
    </Modal>
  );
}

function ConvertToOrder({ requisition, onClose, onDone }) {
  const suppliers = useLookup('/mm/suppliers?pageSize=100&status=ACTIVE');
  const orgs = useLookup(`/org/purchasing-org-plants?pageSize=100&plant_id=${requisition.plant_id}`);
  const allOrgs = useLookup('/org/purchasing-organizations?pageSize=100');
  const groups = useLookup('/org/purchasing-groups?pageSize=100');
  const taxes = useLookup('/org/tax-codes?pageSize=100&is_active=true');
  const [f, setF] = useState({ supplier_id: '', purchasing_organization_id: '', purchasing_group_id: '', tax_code_id: '' });
  const [err, setErr] = useState('');
  const orgOptions = allOrgs.filter((o) => orgs.some((x) => x.purchasing_organization_id === o.id)).map(codeName);

  async function save() {
    try { onDone((await api('/mm/purchase-orders/from-requisition', { method: 'POST', body: { requisition_id: requisition.id, ...f } })).data); }
    catch (e) { setErr(errorText(e)); }
  }

  return (
    <Modal title={`Converter ${requisition.number} em pedido`} onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Criar pedido (rascunho)</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Fornecedor" required><Select value={f.supplier_id} onChange={(v) => setF({ ...f, supplier_id: v })} options={suppliers.map(codeName)} /></Field>
        <Field label="Organização de compras" required><Select value={f.purchasing_organization_id} onChange={(v) => setF({ ...f, purchasing_organization_id: v })} options={orgOptions} /></Field>
        <Field label="Grupo de compradores"><Select value={f.purchasing_group_id} onChange={(v) => setF({ ...f, purchasing_group_id: v })} options={groups.map(codeName)} /></Field>
        <Field label="Imposto (todos os itens)"><Select value={f.tax_code_id} placeholder="Sem imposto" onChange={(v) => setF({ ...f, tax_code_id: v })} options={taxes.map((t) => ({ value: t.id, label: `${t.code} – ${t.name}` }))} /></Field>
      </div>
      <p className="hint small">Os preços vêm do registro info do fornecedor (ou do preço de referência do material). O pedido nasce como rascunho para revisão.</p>
    </Modal>
  );
}
