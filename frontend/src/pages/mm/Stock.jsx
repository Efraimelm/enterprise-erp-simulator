import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Field, Modal, Pager, Select, codeName, errorText, fmtDate, fmtQty, useList, useLookup } from '../../components/ui.jsx';

const TABS = [['saldos', 'Saldos'], ['movimentos', 'Movimentos'], ['inventarios', 'Inventários']];

export default function Stock() {
  const { can } = useAuth();
  const [tab, setTab] = useState('saldos');
  const [dialog, setDialog] = useState(null); // 'move' | 'inventory'
  const [msg, setMsg] = useState('');
  const [version, setVersion] = useState(0);

  return (
    <>
      <div className="page-header">
        <h1>Estoque</h1>
        <p className="hint">Saldo por material e depósito (inspirado no MMBE). Todo saldo muda só por documento de material, com responsável e justificativa.</p>
      </div>
      <Alert ok={msg} />
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
        <span className="shellbar-spacer" />
        {can('MM.STOCK.ADJUST') && <button className="btn btn-small" onClick={() => setDialog('move')}>Movimentar (561/201/311)</button>}
        {can('MM.STOCK.ADJUST') && <button className="btn btn-small" onClick={() => setDialog('inventory')}>Lançar inventário</button>}
      </div>
      {tab === 'saldos' && <Balances key={version} />}
      {tab === 'movimentos' && <Movements key={version} />}
      {tab === 'inventarios' && <Inventories key={version} />}
      {dialog === 'move' && <MoveForm onClose={() => setDialog(null)} onSaved={(r) => { setDialog(null); setMsg(`Documento de material ${r.doc_number} lançado.`); setVersion((v) => v + 1); }} />}
      {dialog === 'inventory' && <InventoryForm onClose={() => setDialog(null)} onSaved={(r) => { setDialog(null); setMsg(`Inventário ${r.doc_number} lançado${r.material_doc_number ? ` (diferenças no documento ${r.material_doc_number})` : ' sem diferenças'}.`); setVersion((v) => v + 1); }} />}
    </>
  );
}

function PlantFilter({ list }) {
  const plants = useLookup('/org/plants?pageSize=100');
  return (
    <select aria-label="Centro" value={list.filters.plant_id} onChange={(e) => list.setFilter('plant_id', e.target.value)}>
      <option value="">Todos os centros</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
    </select>
  );
}

function Balances() {
  const list = useList('/mm/stock', { q: '', plant_id: '', below_reorder: '' }, 50);
  return (
    <section className="card">
      <div className="toolbar">
        <input type="search" placeholder="Material" aria-label="Material" value={list.filters.q} onChange={(e) => list.setFilter('q', e.target.value)} />
        <PlantFilter list={list} />
        <label className="checkbox"><input type="checkbox" checked={list.filters.below_reorder === 'true'} onChange={(e) => list.setFilter('below_reorder', e.target.checked ? 'true' : '')} /> Só abaixo do ponto de reposição</label>
      </div>
      <Alert error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Material</th><th>Centro</th><th>Depósito</th><th>Físico</th><th>Reservado</th><th>Disponível</th><th>Mínimo</th><th>Ponto de reposição</th><th>Máximo</th></tr></thead>
          <tbody>
            {!list.data && <tr><td colSpan={9} className="empty">Carregando…</td></tr>}
            {list.data?.data.length === 0 && <tr><td colSpan={9} className="empty">Nenhum saldo.</td></tr>}
            {list.data?.data.map((b) => (
              <tr key={b.id} className={b.reorder_point > 0 && b.available_qty <= b.reorder_point ? 'row-warn' : ''}>
                <td><strong>{b.material_code}</strong> – {b.description}</td><td>{b.plant_code}</td><td>{b.sloc_code} – {b.sloc_name}</td>
                <td>{fmtQty(b.physical_qty, b.base_unit)}</td><td>{fmtQty(b.reserved_qty)}</td><td><strong>{fmtQty(b.available_qty)}</strong></td>
                <td>{fmtQty(b.min_stock)}</td><td>{fmtQty(b.reorder_point)}</td><td>{fmtQty(b.max_stock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint small">Linhas destacadas: disponível no depósito ≤ ponto de reposição do centro. O filtro considera a soma de todos os depósitos do centro.</p>
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </section>
  );
}

function Movements() {
  const list = useList('/mm/stock/movements', { plant_id: '', movement_type: '', doc_number: '' }, 50);
  return (
    <section className="card">
      <div className="toolbar">
        <input placeholder="Documento" aria-label="Documento" value={list.filters.doc_number} onChange={(e) => list.setFilter('doc_number', e.target.value)} />
        <PlantFilter list={list} />
        <select aria-label="Tipo de movimento" value={list.filters.movement_type} onChange={(e) => list.setFilter('movement_type', e.target.value)}>
          <option value="">Todos os tipos</option>{['101', '201', '311', '561', '701', '702'].map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <Alert error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>Documento</th><th>Linha</th><th>Tipo</th><th>Material</th><th>Centro/depósito</th><th>Quantidade</th><th>Justificativa</th><th>Por</th><th>Quando</th></tr></thead>
          <tbody>
            {!list.data && <tr><td colSpan={9} className="empty">Carregando…</td></tr>}
            {list.data?.data.length === 0 && <tr><td colSpan={9} className="empty">Nenhum movimento.</td></tr>}
            {list.data?.data.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.doc_number}</strong></td><td>{m.line_no}</td><td title={m.movement_label}>{m.movement_type} <span className="hint small">{m.movement_label}</span></td>
                <td>{m.material_code}</td><td>{m.plant_code}/{m.sloc_code}</td>
                <td className={m.quantity < 0 ? 'neg' : 'pos'}>{m.quantity > 0 ? '+' : ''}{fmtQty(m.quantity, m.base_unit)}</td>
                <td>{m.reason ?? '—'}</td><td>{m.posted_by_username}</td><td className="nowrap">{fmtDate(m.posted_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </section>
  );
}

function Inventories() {
  const list = useList('/mm/inventory', { plant_id: '' });
  const [open, setOpen] = useState(null);
  return (
    <section className="card">
      <div className="toolbar"><PlantFilter list={list} /></div>
      <Alert error={list.error} />
      <table>
        <thead><tr><th>Documento</th><th>Centro/depósito</th><th>Itens</th><th>Com diferença</th><th>Doc. material</th><th>Justificativa</th><th>Por</th><th>Quando</th><th aria-label="Ações" /></tr></thead>
        <tbody>
          {list.data?.data.length === 0 && <tr><td colSpan={9} className="empty">Nenhum inventário.</td></tr>}
          {list.data?.data.map((i) => (
            <tr key={i.id}>
              <td><strong>{i.doc_number}</strong></td><td>{i.plant_code}/{i.sloc_code}</td><td>{i.item_count}</td><td>{i.difference_count}</td>
              <td>{i.material_doc_number ?? '—'}</td><td>{i.reason}</td><td>{i.posted_by_username}</td><td className="nowrap">{fmtDate(i.posted_at)}</td>
              <td className="actions"><button className="btn btn-small" onClick={() => api(`/mm/inventory/${i.id}`).then((r) => setOpen(r.data))}>Abrir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <Modal title={`Inventário ${open.doc_number}`} onClose={() => setOpen(null)}>
          <table>
            <thead><tr><th>Material</th><th>Saldo contábil</th><th>Contado</th><th>Diferença</th></tr></thead>
            <tbody>{open.items.map((it) => <tr key={it.id}><td>{it.material_code} – {it.description}</td><td>{fmtQty(it.book_qty)}</td><td>{fmtQty(it.counted_qty)}</td><td className={it.difference < 0 ? 'neg' : it.difference > 0 ? 'pos' : ''}>{fmtQty(it.difference)}</td></tr>)}</tbody>
          </table>
        </Modal>
      )}
    </section>
  );
}

function usePlantContext(plantId) {
  return {
    materials: useLookup(`/mm/materials?pageSize=100&status=ACTIVE&plant_id=${plantId || ''}`),
    slocs: useLookup(`/org/storage-locations?pageSize=100&plant_id=${plantId || 0}`),
  };
}

function MoveForm({ onClose, onSaved }) {
  const plants = useLookup('/org/plants?pageSize=100');
  const [f, setF] = useState({ movement_type: '561', plant_id: '', material_id: '', storage_location_id: '', to_storage_location_id: '', quantity: '', reason: '' });
  const { materials, slocs } = usePlantContext(f.plant_id);
  const [err, setErr] = useState('');

  async function save() {
    setErr('');
    const { to_storage_location_id, ...rest } = f;
    const body = f.movement_type === '311' ? f : rest;
    try { onSaved((await api('/mm/stock/movements', { method: 'POST', body })).data); } catch (e) { setErr(errorText(e)); }
  }

  return (
    <Modal title="Movimentar estoque" onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={() => window.confirm('Lançar o movimento? O documento de material não pode ser apagado.') && save()}>Lançar</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Tipo de movimento" required>
          <Select value={f.movement_type} onChange={(v) => setF({ ...f, movement_type: String(v) })} options={[
            { value: '561', label: '561 – Entrada inicial / ajuste de entrada' },
            { value: '201', label: '201 – Saída para consumo' },
            { value: '311', label: '311 – Transferência entre depósitos' },
          ]} />
        </Field>
        <Field label="Centro" required><Select value={f.plant_id} onChange={(v) => setF({ ...f, plant_id: v, material_id: '', storage_location_id: '', to_storage_location_id: '' })} options={plants.map(codeName)} /></Field>
        <Field label="Material" required><Select value={f.material_id} onChange={(v) => setF({ ...f, material_id: v })} options={materials.map(codeName)} /></Field>
        <Field label={f.movement_type === '311' ? 'Depósito de origem' : 'Depósito'} required><Select value={f.storage_location_id} onChange={(v) => setF({ ...f, storage_location_id: v })} options={slocs.map(codeName)} /></Field>
        {f.movement_type === '311' && <Field label="Depósito de destino" required><Select value={f.to_storage_location_id} onChange={(v) => setF({ ...f, to_storage_location_id: v })} options={slocs.map(codeName)} /></Field>}
        <Field label="Quantidade" required><input type="number" min="0" step="0.001" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="Justificativa" required hint="Obrigatória: fica no documento e na auditoria"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function InventoryForm({ onClose, onSaved }) {
  const plants = useLookup('/org/plants?pageSize=100');
  const [plantId, setPlantId] = useState('');
  const [slocId, setSlocId] = useState('');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({});
  const [err, setErr] = useState('');
  const { slocs } = usePlantContext(plantId);

  async function loadBook(sloc) {
    setSlocId(sloc);
    if (!sloc) return setRows(null);
    const r = await api(`/mm/stock?pageSize=100&storage_location_id=${sloc}`);
    setRows(r.data);
    setCounts(Object.fromEntries(r.data.map((b) => [b.material_id, b.physical_qty])));
  }

  async function save() {
    setErr('');
    const items = Object.entries(counts).map(([material_id, counted_qty]) => ({ material_id: Number(material_id), counted_qty }));
    try { onSaved((await api('/mm/inventory', { method: 'POST', body: { plant_id: plantId, storage_location_id: slocId, reason, items } })).data); }
    catch (e) { setErr(errorText(e)); }
  }

  return (
    <Modal wide title="Lançar inventário (contagem física)" onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!rows?.length} onClick={() => window.confirm('Lançar as diferenças (701/702)? Isso altera o estoque.') && save()}>Lançar diferenças</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Centro" required><Select value={plantId} onChange={(v) => { setPlantId(v); setRows(null); setSlocId(''); }} options={plants.map(codeName)} /></Field>
        <Field label="Depósito" required><Select value={slocId} onChange={loadBook} options={slocs.map(codeName)} /></Field>
        <Field label="Justificativa" required><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex.: Inventário rotativo de novembro" /></Field>
      </div>
      {rows && (
        <table>
          <thead><tr><th>Material</th><th>Saldo contábil</th><th>Contagem</th><th>Diferença</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="empty">Nenhum material com saldo neste depósito.</td></tr>}
            {rows.map((b) => {
              const d = Number(counts[b.material_id] ?? 0) - b.physical_qty;
              return (
                <tr key={b.material_id}>
                  <td>{b.material_code} – {b.description}</td><td>{fmtQty(b.physical_qty, b.base_unit)}</td>
                  <td><input type="number" min="0" step="0.001" className="input-qty" value={counts[b.material_id]} onChange={(e) => setCounts({ ...counts, [b.material_id]: e.target.value })} aria-label={`Contagem de ${b.material_code}`} /></td>
                  <td className={d < 0 ? 'neg' : d > 0 ? 'pos' : ''}>{d === 0 ? '—' : fmtQty(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
