import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, Status, codeName, errorText, fmtDate, fmtMoney, fmtQty, today, useList, useLookup } from '../../components/ui.jsx';
import { History } from '../mm/Materials.jsx';

export const SO_LABEL = {
  DRAFT: ['Rascunho', 'off'], PENDING_APPROVAL: ['Aguardando aprovação', 'warn'], CONFIRMED: ['Confirmado', 'ok'], IN_DELIVERY: ['Em entrega', 'warn'],
  PARTIALLY_DELIVERED: ['Parcialmente entregue', 'warn'], DELIVERED: ['Entregue', 'ok'], BILLED: ['Faturado', 'ok'], CANCELLED: ['Cancelado', 'off'],
};
export const SoStatus = ({ value }) => { const [l, c] = SO_LABEL[value] ?? [value, 'off']; return <span className={`status ${c}`}>{l}</span>; };

export default function SalesOrders() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const list = useList('/sd/sales-orders', { status: '', plant_id: '', q: '' });
  const plants = useLookup('/org/plants?pageSize=100');
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState('');
  const openId = params.get('abrir') ? Number(params.get('abrir')) : null;
  const setOpenId = (id) => setParams(id ? { abrir: String(id) } : {});

  return (
    <>
      <div className="page-header">
        <h1>Pedidos de venda</h1>
        <p className="hint">Inspirado no VA01. Preço pelas condições comerciais, disponibilidade por ATP simplificado e reserva do estoque na confirmação.</p>
      </div>
      <Alert ok={msg} error={list.error} />
      <section className="card">
        <div className="card-header">
          <div className="toolbar">
            <input type="search" placeholder="Número ou referência do cliente" aria-label="Buscar" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
            <select aria-label="Centro" value={list.filters.plant_id} onChange={(e) => list.setFilter('plant_id', e.target.value)}>
              <option value="">Todos os centros</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
            </select>
            <select aria-label="Status" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
              <option value="">Todos os status</option>{Object.entries(SO_LABEL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          {can('SD.SALES_ORDER.CREATE') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo pedido</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Número</th><th>Cliente</th><th>Centro</th><th>Itens</th><th>Data desejada</th><th>Total</th><th>Vendedor</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={9} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={9} className="empty">Nenhum pedido.</td></tr>}
              {list.data?.data.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.number}</strong>{o.customer_reference && <div className="hint small">ref. {o.customer_reference}</div>}</td>
                  <td>{o.customer_code} – {o.customer_name}</td><td>{o.plant_code}</td><td>{o.item_count}</td><td>{fmtDate(o.requested_date)}</td>
                  <td className="nowrap">{fmtMoney(o.total_gross, o.currency)}</td><td>{o.created_by_username}</td><td><SoStatus value={o.status} /></td>
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
  const customers = useLookup('/sd/customers?pageSize=100&status=ACTIVE');
  const orgs = useLookup('/org/sales-organizations?pageSize=100');
  const channels = useLookup('/org/distribution-channels?pageSize=100');
  const divisions = useLookup('/org/divisions?pageSize=100');
  const taxes = useLookup('/org/tax-codes?pageSize=100&is_active=true');
  const [h, setH] = useState({
    customer_id: order.customer_id ?? '', sales_organization_id: order.sales_organization_id ?? '', distribution_channel_id: order.distribution_channel_id ?? '',
    division_id: order.division_id ?? '', plant_id: order.plant_id ?? '', requested_date: order.requested_date ?? today(3),
    allow_partial: order.allow_partial ?? true, customer_reference: order.customer_reference ?? '', notes: order.notes ?? '',
  });
  const [items, setItems] = useState(order.items?.map((i) => ({ item_no: i.item_no, material_id: i.material_id, quantity: i.quantity, tax_code_id: i.tax_code_id ?? '' })) ?? [{ material_id: '', quantity: '', tax_code_id: '' }]);
  const [atp, setAtp] = useState(null);
  const [err, setErr] = useState('');
  const materials = useLookup(`/mm/materials?pageSize=100&status=ACTIVE&plant_id=${h.plant_id || ''}`);
  const set = (i, patch) => { setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it))); setAtp(null); };

  const payloadItems = () => items.map((it) => ({ ...(it.item_no ? { item_no: it.item_no } : {}), material_id: it.material_id, quantity: it.quantity, ...(it.tax_code_id !== '' ? { tax_code_id: it.tax_code_id } : {}) }));

  async function checkAtp() {
    setErr('');
    try { setAtp((await api('/sd/atp', { method: 'POST', body: { plant_id: h.plant_id, items: items.map((i) => ({ material_id: i.material_id, quantity: i.quantity })) } })).data); }
    catch (e) { setErr(errorText(e)); }
  }
  async function save() {
    setErr('');
    try {
      const body = { ...h, items: payloadItems() };
      const r = isNew ? await api('/sd/sales-orders', { method: 'POST', body }) : await api(`/sd/sales-orders/${order.id}`, { method: 'PUT', body });
      onSaved(r.data);
    } catch (e) { setErr(errorText(e)); }
  }

  return (
    <Modal wide title={isNew ? 'Novo pedido de venda' : `Editar pedido ${order.number}`} onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn" disabled={!h.plant_id} onClick={checkAtp}>Verificar disponibilidade</button><button className="btn btn-primary" onClick={save}>Salvar rascunho</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Cliente" required><Select value={h.customer_id} onChange={(v) => setH({ ...h, customer_id: v })} options={customers.map(codeName)} /></Field>
        <Field label="Organização de vendas" required><Select value={h.sales_organization_id} onChange={(v) => setH({ ...h, sales_organization_id: v })} options={orgs.map(codeName)} /></Field>
        <Field label="Canal" required><Select value={h.distribution_channel_id} onChange={(v) => setH({ ...h, distribution_channel_id: v })} options={channels.map(codeName)} /></Field>
        <Field label="Setor de atividade" required><Select value={h.division_id} onChange={(v) => setH({ ...h, division_id: v })} options={divisions.map(codeName)} /></Field>
        <Field label="Centro fornecedor" required><Select value={h.plant_id} onChange={(v) => { setH({ ...h, plant_id: v }); setAtp(null); }} options={plants.map(codeName)} /></Field>
        <Field label="Data desejada" required><input type="date" value={h.requested_date} onChange={(e) => setH({ ...h, requested_date: e.target.value })} /></Field>
        <Field label="Referência do cliente"><input value={h.customer_reference} onChange={(e) => setH({ ...h, customer_reference: e.target.value })} /></Field>
        <Field label="Observações"><input value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} /></Field>
      </div>
      <label className="checkbox"><input type="checkbox" checked={h.allow_partial} onChange={(e) => setH({ ...h, allow_partial: e.target.checked })} /> Permitir atendimento parcial (confirma o que houver em estoque)</label>
      {h.plant_id ? (
        <div className="items-editor">
          <table>
            <thead><tr><th>Item</th><th>Material</th><th>Quantidade</th><th>Imposto</th>{atp && <><th>Disponível</th><th>Confirmável</th><th>Falta</th></>}<th aria-label="Remover" /></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{it.item_no ?? (i + 1) * 10}</td>
                  <td className="min-w"><Select value={it.material_id} onChange={(v) => set(i, { material_id: v })} options={materials.map(codeName)} /></td>
                  <td><input type="number" min="0" step="0.001" className="input-qty" value={it.quantity} onChange={(e) => set(i, { quantity: e.target.value })} aria-label={`Quantidade do item ${i + 1}`} /></td>
                  <td><Select value={it.tax_code_id} placeholder="Padrão (parâmetro)" onChange={(v) => set(i, { tax_code_id: v })} options={taxes.map((t) => ({ value: t.id, label: `${t.code} (${t.rate}%)` }))} /></td>
                  {atp && <><td>{fmtQty(atp[i]?.available)}</td><td>{fmtQty(atp[i]?.confirmable)}</td><td className={atp[i]?.shortfall > 0 ? 'neg' : ''}>{fmtQty(atp[i]?.shortfall)}</td></>}
                  <td><button type="button" className="btn btn-small btn-danger" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={`Remover item ${i + 1}`}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-small" onClick={() => setItems([...items, { material_id: '', quantity: '', tax_code_id: '' }])}>+ Item</button>
        </div>
      ) : <p className="hint">Escolha o centro fornecedor para listar os materiais.</p>}
      <p className="hint small">Preço, desconto e imposto são calculados ao salvar, a partir das condições comerciais. A disponibilidade só é reservada quando o pedido é confirmado.</p>
    </Modal>
  );
}

function OrderDetail({ id, onClose, onEdit, onChanged }) {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [o, setO] = useState(null);
  const [msg, setMsg] = useState({});
  const reload = () => api(`/sd/sales-orders/${id}`).then((r) => setO(r.data)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { reload(); }, [id]);

  async function act(path, body, ok) {
    try { const r = await api(`/sd/sales-orders/${id}/${path}`, { method: 'POST', body }); setO(r.data); setMsg({ ok: typeof ok === 'function' ? ok(r.data) : ok }); onChanged(); }
    catch (e) { setMsg({ error: errorText(e) }); }
  }
  const withReason = (path, label) => { const reason = window.prompt(`Motivo para ${label}:`); if (reason) act(path, { reason }, `Pedido: ${label} feito.`); };

  if (!o) return <Modal title="Pedido de venda" onClose={onClose}><Alert error={msg.error} />{!msg.error && 'Carregando…'}</Modal>;
  const mine = o.created_by === user.id;
  const deliverable = o.items.some((i) => i.deliverable_qty > 0);
  const unconfirmed = o.items.some((i) => i.unconfirmed_qty > 0);

  return (
    <Modal wide title={`Pedido de venda ${o.number}`} onClose={onClose}>
      <Alert error={msg.error} ok={msg.ok} />
      <p>
        <SoStatus value={o.status} /> · {o.customer_code} – {o.customer_name} · {o.sales_org_code}/{o.channel_name}/{o.division_name} · centro {o.plant_code}
        {' '}· desejado {fmtDate(o.requested_date)} · {o.payment_term_name ?? 'sem condição'} · {o.allow_partial ? 'aceita parcial' : 'só entrega completa'}
      </p>
      <p className="hint small">
        Criado por {o.created_by_username} em {fmtDate(o.created_at)}
        {o.auto_approved && ` · confirmado sem aprovação (total ≤ ${fmtMoney(o.approval_limit)})`}
        {o.approved_by_username && ` · aprovado por ${o.approved_by_username}`}{o.ship_to && ` · entregar em: ${o.ship_to}`}
      </p>
      {o.status_note && <div className="alert warn-box">{o.status_note}</div>}
      <div className="row-actions">
        {o.status === 'DRAFT' && can('SD.SALES_ORDER.CREATE') && <button className="btn btn-small" onClick={() => onEdit(o)}>Editar</button>}
        {o.status === 'DRAFT' && can('SD.SALES_ORDER.CREATE') && <button className="btn btn-small btn-primary" onClick={() => act('submit', undefined, (r) => (r.status === 'CONFIRMED' ? 'Pedido confirmado e estoque reservado.' : 'Enviado para aprovação.'))}>Confirmar pedido</button>}
        {o.status === 'PENDING_APPROVAL' && can('SD.SALES_ORDER.APPROVE') && !mine && <button className="btn btn-small btn-primary" onClick={() => act('approve', undefined, 'Pedido aprovado e estoque reservado.')}>Aprovar</button>}
        {o.status === 'PENDING_APPROVAL' && can('SD.SALES_ORDER.APPROVE') && !mine && <button className="btn btn-small btn-danger" onClick={() => withReason('reject', 'rejeitar')}>Rejeitar</button>}
        {o.status === 'PENDING_APPROVAL' && mine && <span className="hint">Aguardando outro aprovador (acima de {fmtMoney(o.approval_limit)}).</span>}
        {unconfirmed && ['CONFIRMED', 'IN_DELIVERY', 'PARTIALLY_DELIVERED'].includes(o.status) && can('SD.SALES_ORDER.CREATE') && <button className="btn btn-small" onClick={() => act('reconfirm', undefined, 'Disponibilidade verificada de novo.')}>Verificar disponibilidade de novo</button>}
        {deliverable && can('SD.DELIVERY.CREATE') && <button className="btn btn-small btn-primary" onClick={() => navigate(`/sd/entregas?pedido=${o.id}`)}>Criar entrega</button>}
        {['DRAFT', 'PENDING_APPROVAL', 'CONFIRMED'].includes(o.status) && can('SD.SALES_ORDER.APPROVE') && <button className="btn btn-small btn-danger" onClick={() => withReason('cancel', 'cancelar')}>Cancelar pedido</button>}
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Material</th><th>Qtd.</th><th>Confirmado</th><th>Entregue</th><th>Faturado</th><th>Preço</th><th>Desconto</th><th>Imposto</th><th>Líquido</th></tr></thead>
          <tbody>
            {o.items.map((i) => (
              <tr key={i.id}>
                <td>{i.item_no}</td><td>{i.material_code} – {i.description}<div className="hint small">depósito {i.sloc_code}</div></td>
                <td>{fmtQty(i.quantity, i.base_unit)}</td>
                <td className={i.unconfirmed_qty > 0 && o.status !== 'DRAFT' ? 'neg' : ''}>{fmtQty(i.confirmed_qty)}{i.unconfirmed_qty > 0 && o.status !== 'DRAFT' && <div className="hint small">faltam {fmtQty(i.unconfirmed_qty)}</div>}</td>
                <td>{fmtQty(i.delivered_qty)}{i.in_delivery_qty > 0 && <div className="hint small">{fmtQty(i.in_delivery_qty)} em entrega</div>}</td>
                <td>{fmtQty(i.billed_qty)}</td>
                <td>{fmtMoney(i.unit_price, o.currency)}<div className="hint small">{{ CUSTOMER: 'do cliente', CHANNEL: 'do canal', GENERAL: 'geral' }[i.price_source]}</div></td>
                <td>{i.discount_pct > 0 ? `${i.discount_pct}% = ${fmtMoney(i.discount_amount, o.currency)}` : '—'}</td>
                <td>{i.tax_code ? `${i.tax_code} ${i.tax_rate}%` : '—'}</td><td>{fmtMoney(i.net_amount, o.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="right">Bruto de tabela {fmtMoney(o.total_gross_list, o.currency)} − descontos {fmtMoney(o.total_discount, o.currency)} = líquido {fmtMoney(o.total_net, o.currency)} + impostos {fmtMoney(o.total_tax, o.currency)} = <strong>{fmtMoney(o.total_gross, o.currency)}</strong></p>

      <h4>Fluxo de documentos</h4>
      <ul className="doc-flow">
        <li>Pedido <strong>{o.number}</strong> <SoStatus value={o.status} /></li>
        {o.deliveries.map((d) => <li key={`d${d.id}`}>Entrega <button className="link" onClick={() => navigate(`/sd/entregas?abrir=${d.id}`)}>{d.number}</button> · {d.status}{d.material_doc_number && ` · saída ${d.material_doc_number}`}</li>)}
        {o.billings.map((b) => <li key={`b${b.id}`}>{b.type === 'INVOICE' ? 'Fatura' : 'Estorno'} <button className="link" onClick={() => navigate(`/sd/faturamento?abrir=${b.id}`)}>{b.number}</button> · {fmtMoney(b.total_gross, o.currency)} · {b.status}</li>)}
        {o.receivables.map((r) => <li key={`r${r.id}`}>Título da fatura {r.number} · {fmtMoney(r.amount, o.currency)} · pago {fmtMoney(r.paid_amount, o.currency)} · vence {fmtDate(r.due_date)} · <Status value={r.status} /></li>)}
      </ul>
      <History items={o.history} />
    </Modal>
  );
}
