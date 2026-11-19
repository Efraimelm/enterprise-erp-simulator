import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import ItemsEditor, { itemsPayload } from '../../components/ItemsEditor.jsx';
import { Alert, Field, Modal, Pager, Select, Status, codeName, errorText, fmtDate, fmtMoney, fmtQty, today, useList, useLookup } from '../../components/ui.jsx';
import { History } from './Materials.jsx';

export default function PurchaseOrders() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useList('/mm/purchase-orders', { status: '', plant_id: '', q: '' });
  const plants = useLookup('/org/plants?pageSize=100');
  const [editing, setEditing] = useState(null);
  const openId = params.get('abrir') ? Number(params.get('abrir')) : null;
  const setOpenId = (id) => setParams(id ? { abrir: String(id) } : {});
  const [msg, setMsg] = useState('');

  return (
    <>
      <div className="page-header">
        <h1>Pedidos de compra</h1>
        <p className="hint">Inspirado no ME21N. Até o limite de aprovação o pedido é aprovado automaticamente; acima dele, outra pessoa aprova.</p>
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
              {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {can('MM.PURCHASE_ORDER.CREATE') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo pedido</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Número</th><th>Fornecedor</th><th>Centro</th><th>Itens</th><th>Entrega</th><th>Total bruto</th><th>Criado por</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={9} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={9} className="empty">Nenhum pedido.</td></tr>}
              {list.data?.data.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.number}</strong></td><td>{o.supplier_code} – {o.supplier_name}</td><td>{o.plant_code}</td><td>{o.item_count}</td>
                  <td>{fmtDate(o.delivery_date)}</td><td className="nowrap">{fmtMoney(o.total_gross, o.currency)}</td><td>{o.created_by_username}</td><td><Status value={o.status} /></td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setOpenId(o.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </section>
      {editing && <OrderForm order={editing} onClose={() => setEditing(null)} onSaved={(o) => { setEditing(null); setMsg(`Pedido ${o.number} salvo como rascunho.`); list.reload(); setOpenId(o.id); }} />}
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} onEdit={(o) => { setOpenId(null); setEditing(o); }} onChanged={list.reload} />}
    </>
  );
}

function OrderForm({ order, onClose, onSaved }) {
  const isNew = !order.id;
  const plants = useLookup('/org/plants?pageSize=100');
  const suppliers = useLookup('/mm/suppliers?pageSize=100&status=ACTIVE');
  const allOrgs = useLookup('/org/purchasing-organizations?pageSize=100');
  const groups = useLookup('/org/purchasing-groups?pageSize=100');
  const terms = useLookup('/org/payment-terms?pageSize=100');
  const taxes = useLookup('/org/tax-codes?pageSize=100&is_active=true');
  const [h, setH] = useState({
    plant_id: order.plant_id ?? '', supplier_id: order.supplier_id ?? '', purchasing_organization_id: order.purchasing_organization_id ?? '',
    purchasing_group_id: order.purchasing_group_id ?? '', payment_term_id: order.payment_term_id ?? '', delivery_date: order.delivery_date ?? today(10), notes: order.notes ?? '',
  });
  const [items, setItems] = useState(order.items?.map((i) => ({ item_no: i.item_no, material_id: i.material_id, quantity: i.quantity, storage_location_id: i.storage_location_id, unit_price: i.unit_price, tax_code_id: i.tax_code_id ?? '' })) ?? [{ material_id: '', quantity: '', storage_location_id: '', tax_code_id: '' }]);
  const [err, setErr] = useState('');
  const assigned = useLookup(`/org/purchasing-org-plants?pageSize=100&plant_id=${h.plant_id || 0}`);
  const materials = useLookup(`/mm/materials?pageSize=100&status=ACTIVE&plant_id=${h.plant_id || ''}`);
  const slocs = useLookup(`/org/storage-locations?pageSize=100&plant_id=${h.plant_id || 0}`);
  const orgOptions = allOrgs.filter((o) => assigned.some((a) => a.purchasing_organization_id === o.id)).map(codeName);

  async function save() {
    setErr('');
    const body = { ...h, items: itemsPayload(items, { price: true, tax: true }) };
    try {
      const r = isNew ? await api('/mm/purchase-orders', { method: 'POST', body }) : await api(`/mm/purchase-orders/${order.id}`, { method: 'PUT', body });
      onSaved(r.data);
    } catch (e) { setErr(errorText(e)); }
  }

  return (
    <Modal wide title={isNew ? 'Novo pedido de compra' : `Editar pedido ${order.number}`} onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Salvar rascunho</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Centro" required><Select value={h.plant_id} onChange={(v) => setH({ ...h, plant_id: v, purchasing_organization_id: '' })} options={plants.map(codeName)} /></Field>
        <Field label="Fornecedor" required><Select value={h.supplier_id} onChange={(v) => setH({ ...h, supplier_id: v })} options={suppliers.map(codeName)} /></Field>
        <Field label="Organização de compras" required hint="Só as que atendem o centro"><Select value={h.purchasing_organization_id} onChange={(v) => setH({ ...h, purchasing_organization_id: v })} options={orgOptions} /></Field>
        <Field label="Grupo de compradores"><Select value={h.purchasing_group_id} onChange={(v) => setH({ ...h, purchasing_group_id: v })} options={groups.map(codeName)} /></Field>
        <Field label="Condição de pagamento" hint="Vazio = a do fornecedor"><Select value={h.payment_term_id} onChange={(v) => setH({ ...h, payment_term_id: v })} options={terms.map(codeName)} /></Field>
        <Field label="Data de entrega" required><input type="date" value={h.delivery_date} onChange={(e) => setH({ ...h, delivery_date: e.target.value })} /></Field>
        <Field label="Observações"><input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
      </div>
      {h.plant_id ? <ItemsEditor items={items} onChange={setItems} materials={materials} slocs={slocs} taxCodes={taxes} columns={{ price: true, tax: true }} /> : <p className="hint">Escolha o centro para listar os materiais.</p>}
      <p className="hint small">Preço em branco = preço do registro info do fornecedor (ou o de referência do material). Impostos são simulados.</p>
    </Modal>
  );
}

function OrderDetail({ id, onClose, onEdit, onChanged }) {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [o, setO] = useState(null);
  const [msg, setMsg] = useState({});
  const reload = () => api(`/mm/purchase-orders/${id}`).then((r) => setO(r.data)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { reload(); }, [id]);

  async function act(path, body, ok, confirm) {
    if (confirm && !window.confirm(confirm)) return;
    try { const r = await api(`/mm/purchase-orders/${id}/${path}`, { method: 'POST', body }); setO(r.data); setMsg({ ok: typeof ok === 'function' ? ok(r.data) : ok }); onChanged(); }
    catch (e) { setMsg({ error: errorText(e) }); }
  }
  const withReason = (path, label) => { const reason = window.prompt(`Motivo para ${label}:`); if (reason) act(path, { reason }, `Pedido: ${label} feito.`); };

  if (!o) return <Modal title="Pedido de compra" onClose={onClose}><Alert error={msg.error} />{!msg.error && 'Carregando…'}</Modal>;
  const mine = o.created_by === user.id;

  return (
    <Modal wide title={`Pedido de compra ${o.number}`} onClose={onClose}>
      <Alert error={msg.error} ok={msg.ok} />
      <p>
        <Status value={o.status} /> · {o.supplier_code} – {o.supplier_name} · centro {o.plant_code} · org. compras {o.purchasing_org_code}
        {o.purchasing_group_code && ` · grupo ${o.purchasing_group_code}`} · {o.payment_term_name ?? 'sem condição'} · entrega {fmtDate(o.delivery_date)}
      </p>
      <p className="hint small">
        Criado por {o.created_by_username} em {fmtDate(o.created_at)}
        {o.auto_approved && ` · aprovado automaticamente (total ≤ ${fmtMoney(o.approval_limit)})`}
        {o.approved_by_username && ` · aprovado por ${o.approved_by_username} em ${fmtDate(o.approved_at)}`}
        {o.sent_at && ` · enviado em ${fmtDate(o.sent_at)} (simulado)`}
      </p>
      {o.status_note && <div className="alert warn-box">{o.status_note}</div>}
      <div className="row-actions">
        {o.status === 'DRAFT' && can('MM.PURCHASE_ORDER.CREATE') && <button className="btn btn-small" onClick={() => onEdit(o)}>Editar</button>}
        {o.status === 'DRAFT' && can('MM.PURCHASE_ORDER.CREATE') && (
          <button className="btn btn-small btn-primary" onClick={() => act('submit', undefined, (r) => (r.status === 'APPROVED' ? 'Aprovado automaticamente (dentro do limite).' : 'Enviado para aprovação.'))}>Enviar para aprovação</button>
        )}
        {o.status === 'PENDING_APPROVAL' && can('MM.PURCHASE_ORDER.APPROVE') && !mine && <button className="btn btn-small btn-primary" onClick={() => act('approve', undefined, 'Pedido aprovado.')}>Aprovar</button>}
        {o.status === 'PENDING_APPROVAL' && can('MM.PURCHASE_ORDER.APPROVE') && !mine && <button className="btn btn-small btn-danger" onClick={() => withReason('reject', 'rejeitar')}>Rejeitar</button>}
        {o.status === 'PENDING_APPROVAL' && mine && <span className="hint">Aguardando outro aprovador (acima de {fmtMoney(o.approval_limit)}).</span>}
        {o.status === 'APPROVED' && can('MM.PURCHASE_ORDER.CREATE') && <button className="btn btn-small" onClick={() => act('send', undefined, 'Envio ao fornecedor registrado (simulado).')}>Enviar ao fornecedor</button>}
        {['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(o.status) && can('MM.GOODS_RECEIPT.POST') && (
          <button className="btn btn-small btn-primary" onClick={() => navigate(`/mm/recebimentos?pedido=${o.id}`)}>Registrar recebimento</button>
        )}
        {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'].includes(o.status) && can('MM.PURCHASE_ORDER.APPROVE') && <button className="btn btn-small btn-danger" onClick={() => withReason('cancel', 'cancelar')}>Cancelar</button>}
      </div>

      <table>
        <thead><tr><th>Item</th><th>Material</th><th>Depósito</th><th>Qtd.</th><th>Recebido</th><th>Pendente</th><th>Preço</th><th>Imposto</th><th>Líquido</th></tr></thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id}>
              <td>{i.item_no}</td><td>{i.material_code} – {i.description}</td><td>{i.sloc_code}</td><td>{fmtQty(i.quantity, i.base_unit)}</td>
              <td>{fmtQty(i.received_qty)}</td><td>{fmtQty(i.open_qty)}</td><td>{fmtMoney(i.unit_price, o.currency)}</td>
              <td>{i.tax_code ? `${i.tax_code} ${i.tax_rate}% = ${fmtMoney(i.tax_amount, o.currency)}` : '—'}</td><td>{fmtMoney(i.net_amount, o.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="right">Líquido {fmtMoney(o.total_net, o.currency)} + impostos {fmtMoney(o.total_tax, o.currency)} = <strong>{fmtMoney(o.total_gross, o.currency)}</strong></p>

      <h4>Documentos relacionados</h4>
      <ul className="doc-flow">
        {o.requisitions.map((r) => <li key={r.id}>Requisição <strong>{r.number}</strong> <Status value={r.status} /></li>)}
        <li>Pedido <strong>{o.number}</strong> <Status value={o.status} /></li>
        {o.receipts.map((g) => <li key={g.id}>Recebimento (documento de material) <strong>{g.doc_number}</strong> · {fmtDate(g.posted_at)} · {g.posted_by_username}</li>)}
      </ul>
      <History items={o.history} />
    </Modal>
  );
}
