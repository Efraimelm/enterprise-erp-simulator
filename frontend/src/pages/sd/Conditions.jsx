import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, codeName, errorText, fmtDate, fmtMoney, today, useList, useLookup } from '../../components/ui.jsx';

export default function Conditions() {
  const [tab, setTab] = useState('prices');
  return (
    <>
      <div className="page-header">
        <h1>Condições comerciais</h1>
        <p className="hint">
          Registros de condição simplificados. <strong>Preço:</strong> vale o do cliente, senão o do canal, senão o geral.
          <strong> Desconto:</strong> vale um só, o mais específico (cliente + material → cliente → material → canal → geral). Sempre dentro da validade.
        </p>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'prices'} className={`tab ${tab === 'prices' ? 'active' : ''}`} onClick={() => setTab('prices')}>Preços</button>
        <button role="tab" aria-selected={tab === 'discounts'} className={`tab ${tab === 'discounts' ? 'active' : ''}`} onClick={() => setTab('discounts')}>Descontos</button>
        <button role="tab" aria-selected={tab === 'sim'} className={`tab ${tab === 'sim' ? 'active' : ''}`} onClick={() => setTab('sim')}>Simular preço</button>
      </div>
      {tab === 'prices' && <ConditionList kind="prices" />}
      {tab === 'discounts' && <ConditionList kind="discounts" />}
      {tab === 'sim' && <Simulation />}
    </>
  );
}

function ConditionList({ kind }) {
  const { can } = useAuth();
  const list = useList(`/sd/${kind}`, { material_id: '', customer_id: '' }, 50);
  const materials = useLookup('/mm/materials?pageSize=100');
  const customers = useLookup('/sd/customers?pageSize=100');
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState('');
  const isPrice = kind === 'prices';

  return (
    <section className="card">
      <Alert ok={msg} error={list.error} />
      <div className="card-header">
        <div className="toolbar">
          <select aria-label="Material" value={list.filters.material_id} onChange={(e) => list.setFilter('material_id', e.target.value)}>
            <option value="">Todos os materiais</option>{materials.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
          </select>
          <select aria-label="Cliente" value={list.filters.customer_id} onChange={(e) => list.setFilter('customer_id', e.target.value)}>
            <option value="">Todos os clientes</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
          </select>
        </div>
        {can('SD.PRICE.UPDATE') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ {isPrice ? 'Novo preço' : 'Novo desconto'}</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Material</th><th>Org.</th><th>Canal</th><th>Cliente</th><th>{isPrice ? 'Preço' : 'Desconto'}</th><th>Validade</th><th>Ativo</th><th aria-label="Ações" /></tr></thead>
          <tbody>
            {list.data?.data.length === 0 && <tr><td colSpan={8} className="empty">Nenhum registro.</td></tr>}
            {list.data?.data.map((r) => (
              <tr key={r.id}>
                <td>{r.material_code ? `${r.material_code} – ${r.material_description}` : <span className="hint">todos</span>}</td><td>{r.sales_org_code}</td>
                <td>{r.channel_name ?? <span className="hint">todos</span>}</td><td>{r.customer_name ?? <span className="hint">todos</span>}</td>
                <td><strong>{isPrice ? fmtMoney(r.price) : `${r.percent}%`}</strong>{r.description && <div className="hint small">{r.description}</div>}</td>
                <td className="nowrap">{fmtDate(r.valid_from)} a {fmtDate(r.valid_to)}</td><td>{r.is_active ? 'Sim' : 'Não'}</td>
                <td className="actions">{can('SD.PRICE.UPDATE') && <button className="btn btn-small" onClick={() => setEditing(r)}>Editar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {editing && <ConditionForm kind={kind} row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setMsg('Condição salva.'); list.reload(); }} />}
    </section>
  );
}

function ConditionForm({ kind, row, onClose, onSaved }) {
  const isPrice = kind === 'prices';
  const isNew = !row.id;
  const [f, setF] = useState({
    material_id: row.material_id ?? '', sales_organization_id: row.sales_organization_id ?? '', distribution_channel_id: row.distribution_channel_id ?? '',
    customer_id: row.customer_id ?? '', valid_from: row.valid_from ?? today(), valid_to: row.valid_to ?? today(365), is_active: row.is_active ?? true,
    ...(isPrice ? { price: row.price ?? '' } : { percent: row.percent ?? '', description: row.description ?? '' }),
  });
  const [err, setErr] = useState('');
  const materials = useLookup('/mm/materials?pageSize=100');
  const orgs = useLookup('/org/sales-organizations?pageSize=100');
  const channels = useLookup('/org/distribution-channels?pageSize=100');
  const customers = useLookup('/sd/customers?pageSize=100');

  async function save() {
    try {
      await api(isNew ? `/sd/${kind}` : `/sd/${kind}/${row.id}`, { method: isNew ? 'POST' : 'PUT', body: { ...f, material_id: f.material_id || (isPrice ? '' : null) } });
      onSaved();
    } catch (e) { setErr(errorText(e)); }
  }

  return (
    <Modal title={`${isNew ? 'Novo' : 'Editar'} ${isPrice ? 'preço' : 'desconto'}`} onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Salvar</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Material" required={isPrice}><Select value={f.material_id} placeholder={isPrice ? 'Selecione…' : 'Todos'} onChange={(v) => setF({ ...f, material_id: v })} options={materials.map(codeName)} /></Field>
        <Field label="Organização de vendas" required><Select value={f.sales_organization_id} onChange={(v) => setF({ ...f, sales_organization_id: v })} options={orgs.map(codeName)} /></Field>
        <Field label="Canal" hint="Vazio = todos"><Select value={f.distribution_channel_id} placeholder="Todos" onChange={(v) => setF({ ...f, distribution_channel_id: v })} options={channels.map(codeName)} /></Field>
        <Field label="Cliente" hint="Vazio = todos"><Select value={f.customer_id} placeholder="Todos" onChange={(v) => setF({ ...f, customer_id: v })} options={customers.map(codeName)} /></Field>
        {isPrice
          ? <Field label="Preço (R$)" required><input type="number" min="0" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          : <>
              <Field label="Desconto (%)" required><input type="number" min="0" max="100" step="0.01" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></Field>
              <Field label="Descrição"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            </>}
        <Field label="Válido de" required><input type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></Field>
        <Field label="Válido até" required><input type="date" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} /></Field>
      </div>
      <label className="checkbox"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Ativo</label>
    </Modal>
  );
}

function Simulation() {
  const materials = useLookup('/mm/materials?pageSize=100');
  const orgs = useLookup('/org/sales-organizations?pageSize=100');
  const channels = useLookup('/org/distribution-channels?pageSize=100');
  const customers = useLookup('/sd/customers?pageSize=100');
  const [f, setF] = useState({ material_id: '', sales_organization_id: '', distribution_channel_id: '', customer_id: '' });
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  const SOURCE = { CUSTOMER: 'preço do cliente', CHANNEL: 'preço do canal', GENERAL: 'preço geral' };

  async function run() {
    setErr('');
    try { setR((await api(`/sd/price-simulation?${new URLSearchParams(f)}`)).data); } catch (e) { setErr(errorText(e)); }
  }
  return (
    <section className="card">
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Material"><Select value={f.material_id} onChange={(v) => setF({ ...f, material_id: v })} options={materials.map(codeName)} /></Field>
        <Field label="Organização de vendas"><Select value={f.sales_organization_id} onChange={(v) => setF({ ...f, sales_organization_id: v })} options={orgs.map(codeName)} /></Field>
        <Field label="Canal"><Select value={f.distribution_channel_id} onChange={(v) => setF({ ...f, distribution_channel_id: v })} options={channels.map(codeName)} /></Field>
        <Field label="Cliente"><Select value={f.customer_id} onChange={(v) => setF({ ...f, customer_id: v })} options={customers.map(codeName)} /></Field>
      </div>
      <button className="btn btn-primary" onClick={run}>Simular</button>
      {r && (
        <p className="sim-result">
          {r.price ? <>Preço <strong>{fmtMoney(r.price.price)}</strong> ({SOURCE[r.price.source]})</> : <strong>Sem preço válido</strong>}
          {' · '}Desconto <strong>{r.discount.percent}%</strong>{r.discount.description ? ` (${r.discount.description})` : ''}
          {r.price && <> · Preço final <strong>{fmtMoney(r.price.price * (1 - r.discount.percent / 100))}</strong> + imposto</>}
        </p>
      )}
    </section>
  );
}
