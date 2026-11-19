import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, Status, clearLookups, codeName, errorText, fmtDate, fmtMoney, fmtQty, useList, useLookup } from '../../components/ui.jsx';

const TYPES = { HAWA: 'Mercadoria para revenda', ROH: 'Matéria-prima', HIBE: 'Material de consumo' };
const UNITS = ['UN', 'KG', 'G', 'L', 'ML', 'M', 'CX', 'PCT'];

export default function Materials() {
  const { can } = useAuth();
  const list = useList('/mm/materials', { q: '', status: '', type: '' });
  const [editing, setEditing] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [msg, setMsg] = useState('');

  return (
    <>
      <div className="page-header">
        <h1>Materiais</h1>
        <p className="hint">Cadastro mestre de materiais (inspirado no MM01/MM02). Os dados de planejamento ficam por centro.</p>
      </div>
      <Alert ok={msg} error={list.error} />
      <section className="card">
        <div className="card-header">
          <div className="toolbar">
            <input type="search" placeholder="Código, descrição ou categoria" aria-label="Buscar" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
            <select aria-label="Tipo" value={list.filters.type} onChange={(e) => list.setFilter('type', e.target.value)}>
              <option value="">Todos os tipos</option>
              {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select aria-label="Status" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
              <option value="">Todos os status</option>
              <option value="ACTIVE">Ativo</option><option value="BLOCKED">Bloqueado</option><option value="INACTIVE">Inativo</option>
            </select>
          </div>
          {can('MM.MATERIAL.CREATE') && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo material</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th>Categoria</th><th>Unid.</th><th>Preço ref.</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {!list.data && <tr><td colSpan={8} className="empty">Carregando…</td></tr>}
              {list.data?.data.length === 0 && <tr><td colSpan={8} className="empty">Nenhum material.</td></tr>}
              {list.data?.data.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.code}</strong></td><td>{m.description}</td><td>{TYPES[m.material_type]}</td><td>{m.category ?? '—'}</td>
                  <td>{m.base_unit}</td><td className="nowrap">{fmtMoney(m.reference_price)}</td><td><Status value={m.status} /></td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setOpenId(m.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      </section>

      {editing && (
        <MaterialForm material={editing} onClose={() => setEditing(null)} onSaved={(m) => { clearLookups(); setEditing(null); setMsg(`Material ${m.code} salvo.`); list.reload(); setOpenId(m.id); }} />
      )}
      {openId && <MaterialDetail id={openId} onClose={() => setOpenId(null)} onEdit={(m) => { setOpenId(null); setEditing(m); }} onChanged={list.reload} />}
    </>
  );
}

function MaterialForm({ material, onClose, onSaved }) {
  const isNew = !material.id;
  const [f, setF] = useState({
    code: material.code ?? '', description: material.description ?? '', material_type: material.material_type ?? 'HAWA',
    category: material.category ?? '', base_unit: material.base_unit ?? 'UN', reference_price: material.reference_price ?? '',
  });
  const [err, setErr] = useState(null);
  const errors = Object.fromEntries((err?.details ?? []).map((d) => [d.field, d.message]));

  async function save() {
    try {
      const r = isNew ? await api('/mm/materials', { method: 'POST', body: f }) : await api(`/mm/materials/${material.id}`, { method: 'PUT', body: f });
      onSaved(r.data);
    } catch (e) { setErr(e); }
  }

  return (
    <Modal title={isNew ? 'Novo material' : `Editar ${material.code}`} onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Salvar</button></>}>
      <Alert error={err && errorText(err)} />
      <div className="form-grid">
        <Field label="Código" required error={errors.code} hint="ex.: ALM-0010"><input value={f.code} disabled={!isNew} style={{ textTransform: 'uppercase' }} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="Descrição" required error={errors.description}><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Tipo" required error={errors.material_type}><Select value={f.material_type} onChange={(v) => setF({ ...f, material_type: v })} options={Object.entries(TYPES).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Categoria" error={errors.category}><input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Unidade de medida" required error={errors.base_unit} hint="Não muda depois de movimentado"><Select value={f.base_unit} onChange={(v) => setF({ ...f, base_unit: v })} options={UNITS.map((u) => ({ value: u, label: u }))} /></Field>
        <Field label="Preço de referência (R$)" required error={errors.reference_price}><input type="number" min="0" step="0.01" value={f.reference_price} onChange={(e) => setF({ ...f, reference_price: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function MaterialDetail({ id, onClose, onEdit, onChanged }) {
  const { can } = useAuth();
  const [m, setM] = useState(null);
  const [msg, setMsg] = useState({});
  const plants = useLookup('/org/plants?pageSize=100');
  const reload = () => api(`/mm/materials/${id}`).then((r) => setM(r.data)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { reload(); }, [id]);

  async function changeStatus(status) {
    const reason = window.prompt('Motivo da alteração de status:');
    if (!reason) return;
    try { await api(`/mm/materials/${id}/status`, { method: 'POST', body: { status, reason } }); setMsg({ ok: 'Status alterado.' }); reload(); onChanged(); }
    catch (e) { setMsg({ error: errorText(e) }); }
  }

  if (!m) return <Modal title="Material" onClose={onClose}><Alert error={msg.error} />{!msg.error && 'Carregando…'}</Modal>;
  const missingPlants = plants.filter((p) => !m.plants.some((d) => d.plant_id === p.id));

  return (
    <Modal wide title={`${m.code} – ${m.description}`} onClose={onClose}>
      <Alert error={msg.error} ok={msg.ok} />
      <p><Status value={m.status} /> · {TYPES[m.material_type]} · {m.base_unit} · preço de referência {fmtMoney(m.reference_price)}</p>
      {can('MM.MATERIAL.UPDATE') && (
        <div className="row-actions">
          <button className="btn btn-small" onClick={() => onEdit(m)}>Editar dados gerais</button>
          {m.status !== 'ACTIVE' && <button className="btn btn-small" onClick={() => changeStatus('ACTIVE')}>Ativar</button>}
          {m.status !== 'BLOCKED' && <button className="btn btn-small btn-danger" onClick={() => changeStatus('BLOCKED')}>Bloquear</button>}
          {m.status !== 'INACTIVE' && <button className="btn btn-small btn-danger" onClick={() => changeStatus('INACTIVE')}>Inativar</button>}
        </div>
      )}

      <h4>Dados por centro (planejamento)</h4>
      {m.plants.map((d) => <PlantData key={d.plant_id} materialId={m.id} data={d} editable={can('MM.MATERIAL.UPDATE')} onSaved={() => { setMsg({ ok: `Centro ${d.plant_code} salvo.` }); reload(); }} />)}
      {m.plants.length === 0 && <p className="hint">Material ainda não cadastrado em nenhum centro do seu escopo.</p>}
      {can('MM.MATERIAL.UPDATE') && missingPlants.length > 0 && (
        <PlantData materialId={m.id} data={null} plants={missingPlants} editable onSaved={() => { setMsg({ ok: 'Material estendido para o centro.' }); reload(); }} />
      )}

      <h4>Estoque por depósito</h4>
      <table>
        <thead><tr><th>Centro</th><th>Depósito</th><th>Físico</th><th>Reservado</th><th>Disponível</th></tr></thead>
        <tbody>
          {m.stock.length === 0 && <tr><td colSpan={5} className="empty">Sem estoque.</td></tr>}
          {m.stock.map((s) => <tr key={s.storage_location_id}><td>{s.plant_code}</td><td>{s.sloc_code} – {s.sloc_name}</td><td>{fmtQty(s.physical_qty, m.base_unit)}</td><td>{fmtQty(s.reserved_qty)}</td><td><strong>{fmtQty(s.available_qty, m.base_unit)}</strong></td></tr>)}
        </tbody>
      </table>

      <h4>Fornecedores (registros info)</h4>
      {m.suppliers.length === 0 ? <p className="hint">Nenhum fornecedor cadastrado para este material.</p> : (
        <table>
          <thead><tr><th>Fornecedor</th><th>Preço</th><th>Prazo</th><th>Status</th></tr></thead>
          <tbody>{m.suppliers.map((s) => <tr key={s.id}><td>{s.code} – {s.name}</td><td>{fmtMoney(s.net_price)}</td><td>{s.lead_time_days} dias</td><td><Status value={s.status} /></td></tr>)}</tbody>
        </table>
      )}

      <History items={m.history} />

    </Modal>
  );
}

function PlantData({ materialId, data, plants, editable, onSaved }) {
  const [plantId, setPlantId] = useState(data?.plant_id ?? '');
  const [f, setF] = useState({
    default_storage_location_id: data?.default_storage_location_id ?? '', purchasing_group_id: data?.purchasing_group_id ?? '',
    min_stock: data?.min_stock ?? 0, reorder_point: data?.reorder_point ?? 0, max_stock: data?.max_stock ?? 0,
  });
  const [err, setErr] = useState('');
  const slocs = useLookup(`/org/storage-locations?pageSize=100&plant_id=${plantId || 0}`);
  const groups = useLookup('/org/purchasing-groups?pageSize=100');

  async function save() {
    setErr('');
    try { await api(`/mm/materials/${materialId}/plants/${plantId}`, { method: 'PUT', body: f }); onSaved(); }
    catch (e) { setErr(errorText(e)); }
  }

  return (
    <div className="subcard">
      <div className="form-grid compact">
        {data ? <Field label="Centro"><input value={`${data.plant_code} – ${data.plant_name}`} disabled /></Field> : (
          <Field label="Estender para o centro"><Select value={plantId} onChange={setPlantId} options={plants.map(codeName)} /></Field>
        )}
        <Field label="Depósito padrão"><Select value={f.default_storage_location_id} disabled={!editable} onChange={(v) => setF({ ...f, default_storage_location_id: v })} options={slocs.map(codeName)} /></Field>
        <Field label="Grupo de compradores"><Select value={f.purchasing_group_id} disabled={!editable} onChange={(v) => setF({ ...f, purchasing_group_id: v })} options={groups.map(codeName)} /></Field>
        <Field label="Estoque mínimo"><input type="number" min="0" value={f.min_stock} disabled={!editable} onChange={(e) => setF({ ...f, min_stock: e.target.value })} /></Field>
        <Field label="Ponto de reposição"><input type="number" min="0" value={f.reorder_point} disabled={!editable} onChange={(e) => setF({ ...f, reorder_point: e.target.value })} /></Field>
        <Field label="Estoque máximo"><input type="number" min="0" value={f.max_stock} disabled={!editable} onChange={(e) => setF({ ...f, max_stock: e.target.value })} /></Field>
      </div>
      {err && <div className="field-error">{err}</div>}
      {editable && <button className="btn btn-small btn-primary" disabled={!plantId} onClick={save}>{data ? 'Salvar centro' : 'Estender'}</button>}
    </div>
  );
}

export function History({ items }) {
  if (!items?.length) return null;
  return (
    <details className="history">
      <summary>Histórico de alterações ({items.length})</summary>
      <table>
        <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhes</th></tr></thead>
        <tbody>
          {items.map((h, i) => (
            <tr key={i}><td className="nowrap">{fmtDate(h.occurred_at)}</td><td>{h.username}</td><td>{h.action}</td><td><pre>{JSON.stringify(h.details, null, 1)}</pre></td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
