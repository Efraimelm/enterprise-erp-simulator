import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, Status, clearLookups, codeName, errorText, fmtDate, fmtMoney, useList, useLookup } from '../../components/ui.jsx';
import { History } from '../mm/Materials.jsx';

const FIELDS = ['code', 'name', 'legal_name', 'tax_id', 'street', 'city', 'state', 'zip', 'ship_to_street', 'ship_to_city', 'ship_to_state', 'ship_to_zip', 'contact_name', 'email', 'phone', 'payment_term_id'];

export default function Customers() {
  const { can } = useAuth();
  const list = useList('/sd/customers', { q: '', status: '' });
  const [editing, setEditing] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState('');

  return (
    <>
      <div className="page-header">
        <h1>Clientes</h1>
        <p className="hint">Dados fictícios. Cada cliente é liberado para as áreas de vendas (organização + canal + setor) em que pode comprar.</p>
      </div>
      <Alert ok={msg} error={list.error} />
      <section className="card">
        <div className="card-header">
          <div className="toolbar">
            <input type="search" placeholder="Código, nome ou cidade" aria-label="Buscar" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
            <select aria-label="Status" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
              <option value="">Todos os status</option><option value="ACTIVE">Ativo</option><option value="BLOCKED">Bloqueado</option><option value="INACTIVE">Inativo</option>
            </select>
          </div>
          {can('SD.CUSTOMER.CREATE') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo cliente</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Código</th><th>Nome</th><th>Cidade</th><th>Pagamento</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={6} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={6} className="empty">Nenhum cliente.</td></tr>}
              {list.data?.data.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.code}</strong></td><td>{c.name}<div className="hint small">{c.legal_name}</div></td>
                  <td>{c.city ? `${c.city}/${c.state ?? ''}` : '—'}</td><td>{c.payment_term_name ?? '—'}</td><td><Status value={c.status} /></td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setOpenId(c.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </section>
      {editing && <CustomerForm customer={editing} onClose={() => setEditing(null)} onSaved={(c) => { clearLookups(); setEditing(null); setMsg(`Cliente ${c.code} salvo.`); list.reload(); setOpenId(c.id); }} />}
      {openId && <CustomerDetail id={openId} onClose={() => setOpenId(null)} onEdit={(c) => { setOpenId(null); setEditing(c); }} onChanged={list.reload} />}
    </>
  );
}

function CustomerForm({ customer, onClose, onSaved }) {
  const isNew = !customer.id;
  const [f, setF] = useState(() => ({ ...Object.fromEntries(FIELDS.map((k) => [k, customer[k] ?? ''])), sales_area_ids: customer.sales_areas?.map((a) => a.id) ?? [] }));
  const [err, setErr] = useState(null);
  const terms = useLookup('/org/payment-terms?pageSize=100');
  const areas = useLookup('/org/sales-areas?pageSize=100&is_active=true');
  const orgs = useLookup('/org/sales-organizations?pageSize=100');
  const channels = useLookup('/org/distribution-channels?pageSize=100');
  const divisions = useLookup('/org/divisions?pageSize=100');
  const errors = Object.fromEntries((err?.details ?? []).map((d) => [d.field, d.message]));
  const input = (k, props = {}) => <input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />;
  const areaLabel = (a) => [orgs.find((o) => o.id === a.sales_organization_id)?.code, channels.find((c) => c.id === a.distribution_channel_id)?.name, divisions.find((d) => d.id === a.division_id)?.name].join(' · ');

  async function save() {
    try {
      const r = isNew ? await api('/sd/customers', { method: 'POST', body: f }) : await api(`/sd/customers/${customer.id}`, { method: 'PUT', body: f });
      onSaved(r.data);
    } catch (e) { setErr(e); }
  }

  return (
    <Modal wide title={isNew ? 'Novo cliente' : `Editar ${customer.code}`} onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Salvar</button></>}>
      <Alert error={err && errorText(err)} />
      <div className="form-grid">
        <Field label="Código" required error={errors.code}>{input('code', { disabled: !isNew, style: { textTransform: 'uppercase' } })}</Field>
        <Field label="Nome fantasia" required error={errors.name}>{input('name')}</Field>
        <Field label="Razão social (fictícia)" required error={errors.legal_name}>{input('legal_name')}</Field>
        <Field label="CNPJ (fictício)" error={errors.tax_id}>{input('tax_id')}</Field>
        <Field label="Endereço" error={errors.street}>{input('street')}</Field>
        <Field label="Cidade" error={errors.city}>{input('city')}</Field>
        <Field label="UF" error={errors.state}>{input('state', { maxLength: 2, style: { textTransform: 'uppercase' } })}</Field>
        <Field label="CEP" error={errors.zip}>{input('zip')}</Field>
        <Field label="Entrega: endereço" hint="Vazio = mesmo endereço">{input('ship_to_street')}</Field>
        <Field label="Entrega: cidade">{input('ship_to_city')}</Field>
        <Field label="Entrega: UF" error={errors.ship_to_state}>{input('ship_to_state', { maxLength: 2, style: { textTransform: 'uppercase' } })}</Field>
        <Field label="Entrega: CEP" error={errors.ship_to_zip}>{input('ship_to_zip')}</Field>
        <Field label="Contato">{input('contact_name')}</Field>
        <Field label="E-mail" error={errors.email}>{input('email', { type: 'email' })}</Field>
        <Field label="Telefone">{input('phone')}</Field>
        <Field label="Condição de pagamento"><Select value={f.payment_term_id} onChange={(v) => setF({ ...f, payment_term_id: v })} options={terms.map(codeName)} /></Field>
      </div>
      <fieldset>
        <legend>Áreas de vendas liberadas</legend>
        {areas.map((a) => (
          <label key={a.id} className="checkbox">
            <input type="checkbox" checked={f.sales_area_ids.includes(a.id)} onChange={(e) => setF({ ...f, sales_area_ids: e.target.checked ? [...f.sales_area_ids, a.id] : f.sales_area_ids.filter((x) => x !== a.id) })} />
            {areaLabel(a)}
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}

function CustomerDetail({ id, onClose, onEdit, onChanged }) {
  const { can } = useAuth();
  const [c, setC] = useState(null);
  const [msg, setMsg] = useState({});
  const reload = () => api(`/sd/customers/${id}`).then((r) => setC(r.data)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { reload(); }, [id]);
  const changeStatus = async (status) => {
    const reason = window.prompt('Motivo da alteração de status:');
    if (!reason) return;
    try { await api(`/sd/customers/${id}/status`, { method: 'POST', body: { status, reason } }); setMsg({ ok: 'Status alterado.' }); reload(); onChanged(); }
    catch (e) { setMsg({ error: errorText(e) }); }
  };
  if (!c) return <Modal title="Cliente" onClose={onClose}><Alert error={msg.error} />{!msg.error && 'Carregando…'}</Modal>;
  return (
    <Modal wide title={`${c.code} – ${c.name}`} onClose={onClose}>
      <Alert error={msg.error} ok={msg.ok} />
      <p><Status value={c.status} /> · {c.legal_name} · {c.city ?? '—'}/{c.state ?? ''} · {c.payment_term_name ?? 'sem condição'}</p>
      <p className="hint small">Entrega: {[c.ship_to_street ?? c.street, c.ship_to_city ?? c.city, c.ship_to_state ?? c.state].filter(Boolean).join(', ') || '—'} · {[c.contact_name, c.email, c.phone].filter(Boolean).join(' · ')}</p>
      {can('SD.CUSTOMER.UPDATE') && (
        <div className="row-actions">
          <button className="btn btn-small" onClick={() => onEdit(c)}>Editar</button>
          {c.status !== 'ACTIVE' && <button className="btn btn-small" onClick={() => changeStatus('ACTIVE')}>Ativar</button>}
          {c.status !== 'BLOCKED' && <button className="btn btn-small btn-danger" onClick={() => changeStatus('BLOCKED')}>Bloquear</button>}
          {c.status !== 'INACTIVE' && <button className="btn btn-small btn-danger" onClick={() => changeStatus('INACTIVE')}>Inativar</button>}
        </div>
      )}
      <h4>Áreas de vendas</h4>
      <p>{c.sales_areas.map((a) => <span key={a.id} className="chip">{a.sales_org_code} · {a.channel_name} · {a.division_name}</span>)}{c.sales_areas.length === 0 && <span className="hint">Nenhuma: o cliente ainda não pode comprar.</span>}</p>
      <h4>Pedidos (centros do seu escopo)</h4>
      <table>
        <thead><tr><th>Pedido</th><th>Centro</th><th>Data</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          {c.orders.length === 0 && <tr><td colSpan={5} className="empty">Nenhum pedido.</td></tr>}
          {c.orders.map((o) => <tr key={o.id}><td>{o.number}</td><td>{o.plant_code}</td><td>{fmtDate(o.created_at)}</td><td>{fmtMoney(o.total_gross, o.currency)}</td><td><Status value={o.status} /></td></tr>)}
        </tbody>
      </table>
      <History items={c.history} />
    </Modal>
  );
}
