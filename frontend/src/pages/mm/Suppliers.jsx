import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, Status, clearLookups, codeName, errorText, fmtDate, fmtMoney, useList, useLookup } from '../../components/ui.jsx';
import { History } from './Materials.jsx';

const EMPTY = { code: '', name: '', legal_name: '', tax_id: '', street: '', city: '', state: '', zip: '', contact_name: '', email: '', phone: '', payment_term_id: '', overdelivery_tolerance_pct: 0 };

export default function Suppliers() {
  const { can } = useAuth();
  const list = useList('/mm/suppliers', { q: '', status: '' });
  const [editing, setEditing] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState('');

  return (
    <>
      <div className="page-header">
        <h1>Fornecedores</h1>
        <p className="hint">Dados fictícios. Os preços por material ficam nos registros info (inspirados no ME11).</p>
      </div>
      <Alert ok={msg} error={list.error} />
      <section className="card">
        <div className="card-header">
          <div className="toolbar">
            <input type="search" placeholder="Código, nome ou cidade" aria-label="Buscar" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
            <select aria-label="Status" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
              <option value="">Todos os status</option>
              <option value="ACTIVE">Ativo</option><option value="BLOCKED">Bloqueado</option><option value="INACTIVE">Inativo</option>
            </select>
          </div>
          {can('MM.SUPPLIER.CREATE') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo fornecedor</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Código</th><th>Nome</th><th>Cidade</th><th>Pagamento</th><th>Tolerância</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={7} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={7} className="empty">Nenhum fornecedor.</td></tr>}
              {list.data?.data.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.code}</strong></td><td>{s.name}<div className="hint small">{s.legal_name}</div></td>
                  <td>{s.city ? `${s.city}/${s.state ?? ''}` : '—'}</td><td>{s.payment_term_name ?? '—'}</td>
                  <td>{s.overdelivery_tolerance_pct}%</td><td><Status value={s.status} /></td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setOpenId(s.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </section>

      {editing && <SupplierForm supplier={editing} onClose={() => setEditing(null)} onSaved={(s) => { clearLookups(); setEditing(null); setMsg(`Fornecedor ${s.code} salvo.`); list.reload(); setOpenId(s.id); }} />}
      {openId && <SupplierDetail id={openId} onClose={() => setOpenId(null)} onEdit={(s) => { setOpenId(null); setEditing(s); }} onChanged={list.reload} />}
    </>
  );
}

function SupplierForm({ supplier, onClose, onSaved }) {
  const isNew = !supplier.id;
  const [f, setF] = useState(() => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, supplier[k] ?? EMPTY[k]])));
  const [err, setErr] = useState(null);
  const terms = useLookup('/org/payment-terms?pageSize=100');
  const errors = Object.fromEntries((err?.details ?? []).map((d) => [d.field, d.message]));
  const input = (k, props = {}) => <input value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />;

  async function save() {
    try {
      const r = isNew ? await api('/mm/suppliers', { method: 'POST', body: f }) : await api(`/mm/suppliers/${supplier.id}`, { method: 'PUT', body: f });
      onSaved(r.data);
    } catch (e) { setErr(e); }
  }

  return (
    <Modal wide title={isNew ? 'Novo fornecedor' : `Editar ${supplier.code}`} onClose={onClose}
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
        <Field label="CEP" error={errors.zip}>{input('zip', { placeholder: '00000-000' })}</Field>
        <Field label="Contato" error={errors.contact_name}>{input('contact_name')}</Field>
        <Field label="E-mail" error={errors.email}>{input('email', { type: 'email' })}</Field>
        <Field label="Telefone" error={errors.phone}>{input('phone')}</Field>
        <Field label="Condição de pagamento" error={errors.payment_term_id}><Select value={f.payment_term_id} onChange={(v) => setF({ ...f, payment_term_id: v })} options={terms.map(codeName)} /></Field>
        <Field label="Tolerância de excesso no recebimento (%)" error={errors.overdelivery_tolerance_pct} hint="Usada só por quem tem permissão de receber acima do pedido">
          {input('overdelivery_tolerance_pct', { type: 'number', min: 0, max: 50, step: 0.01 })}
        </Field>
      </div>
    </Modal>
  );
}

function SupplierDetail({ id, onClose, onEdit, onChanged }) {
  const { can } = useAuth();
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState({});
  const [info, setInfo] = useState({ material_id: '', net_price: '', lead_time_days: 0 });
  const materials = useLookup('/mm/materials?pageSize=100&status=ACTIVE');
  const reload = () => api(`/mm/suppliers/${id}`).then((r) => setS(r.data)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { reload(); }, [id]);
  const editable = can('MM.SUPPLIER.UPDATE');

  async function run(fn, ok) {
    try { await fn(); setMsg({ ok }); reload(); onChanged(); } catch (e) { setMsg({ error: errorText(e) }); }
  }
  const changeStatus = (status) => {
    const reason = window.prompt('Motivo da alteração de status:');
    if (reason) run(() => api(`/mm/suppliers/${id}/status`, { method: 'POST', body: { status, reason } }), 'Status alterado.');
  };

  if (!s) return <Modal title="Fornecedor" onClose={onClose}><Alert error={msg.error} />{!msg.error && 'Carregando…'}</Modal>;

  return (
    <Modal wide title={`${s.code} – ${s.name}`} onClose={onClose}>
      <Alert error={msg.error} ok={msg.ok} />
      <p><Status value={s.status} /> · {s.legal_name} · {s.city ?? '—'}/{s.state ?? ''} · {s.payment_term_name ?? 'sem condição'} · tolerância {s.overdelivery_tolerance_pct}%</p>
      <p className="hint small">{[s.contact_name, s.email, s.phone].filter(Boolean).join(' · ')}</p>
      {editable && (
        <div className="row-actions">
          <button className="btn btn-small" onClick={() => onEdit(s)}>Editar</button>
          {s.status !== 'ACTIVE' && <button className="btn btn-small" onClick={() => changeStatus('ACTIVE')}>Ativar</button>}
          {s.status !== 'BLOCKED' && <button className="btn btn-small btn-danger" onClick={() => changeStatus('BLOCKED')}>Bloquear</button>}
          {s.status !== 'INACTIVE' && <button className="btn btn-small btn-danger" onClick={() => changeStatus('INACTIVE')}>Inativar</button>}
        </div>
      )}

      <h4>Materiais fornecidos (registros info)</h4>
      <table>
        <thead><tr><th>Material</th><th>Preço líquido</th><th>Prazo</th><th aria-label="Ações" /></tr></thead>
        <tbody>
          {s.materials.length === 0 && <tr><td colSpan={4} className="empty">Nenhum material.</td></tr>}
          {s.materials.map((m) => (
            <tr key={m.material_id}>
              <td>{m.code} – {m.description}</td><td>{fmtMoney(m.net_price)} / {m.base_unit}</td><td>{m.lead_time_days} dias</td>
              <td className="actions">{editable && <button className="btn btn-small btn-danger" onClick={() => window.confirm(`Remover o registro info de ${m.code}?`) && run(() => api(`/mm/suppliers/${id}/materials/${m.material_id}`, { method: 'DELETE' }), 'Registro removido.')}>Remover</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {editable && (
        <div className="form-grid compact">
          <Field label="Material"><Select value={info.material_id} onChange={(v) => setInfo({ ...info, material_id: v })} options={materials.map(codeName)} /></Field>
          <Field label="Preço líquido (R$)"><input type="number" min="0" step="0.01" value={info.net_price} onChange={(e) => setInfo({ ...info, net_price: e.target.value })} /></Field>
          <Field label="Prazo de entrega (dias)"><input type="number" min="0" value={info.lead_time_days} onChange={(e) => setInfo({ ...info, lead_time_days: e.target.value })} /></Field>
          <div className="field field-button">
            <button className="btn btn-small btn-primary" disabled={!info.material_id} onClick={() => run(() => api(`/mm/suppliers/${id}/materials/${info.material_id}`, { method: 'PUT', body: { net_price: info.net_price, lead_time_days: info.lead_time_days } }), 'Registro info salvo.')}>Salvar registro info</button>
          </div>
        </div>
      )}

      <h4>Histórico de compras (centros do seu escopo)</h4>
      <table>
        <thead><tr><th>Pedido</th><th>Centro</th><th>Entrega</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          {s.orders.length === 0 && <tr><td colSpan={5} className="empty">Nenhum pedido.</td></tr>}
          {s.orders.map((o) => <tr key={o.id}><td>{o.number}</td><td>{o.plant_code}</td><td>{fmtDate(o.delivery_date)}</td><td>{fmtMoney(o.total_gross, o.currency)}</td><td><Status value={o.status} /></td></tr>)}
        </tbody>
      </table>
      <History items={s.history} />
    </Modal>
  );
}
