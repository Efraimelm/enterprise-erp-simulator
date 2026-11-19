// Tela genérica de cadastro (lista + formulário) montada a partir da definição vinda de /api/org/meta.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, toQuery } from '../api.js';
import { useAuth } from '../auth.jsx';

const TIMEZONES = Intl.supportedValuesOf('timeZone');
const PLACEHOLDERS = { country: 'BR', currency: 'BRL', language: 'pt-BR', uf: 'SP', timezone: 'America/Sao_Paulo' };

const refLabel = (row) => (row.code ? `${row.code} – ${row.name}` : `#${row.id}`);

export default function EntityPage({ entity }) {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [active, setActive] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refOptions, setRefOptions] = useState({});
  const [editing, setEditing] = useState(null); // null = fechado; {} = novo; {id,...} = edição
  const pageSize = 20;

  const refFields = useMemo(() => entity.fields.filter((f) => f.type === 'ref'), [entity]);
  const columns = entity.fields;

  // Opções das listas de seleção (ex.: empresas para o campo "Empresa" do centro).
  useEffect(() => {
    let cancel = false;
    Promise.all(
      [...new Set(refFields.map((f) => f.ref))].map((ref) =>
        api(`/org/${ref}?pageSize=100`).then((r) => [ref, r.data]),
      ),
    )
      .then((pairs) => !cancel && setRefOptions(Object.fromEntries(pairs)))
      .catch((e) => !cancel && setError(e.message));
    return () => { cancel = true; };
  }, [refFields]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api(`/org/${entity.key}${toQuery({ page, pageSize, q, is_active: active })}`);
      setRows(r.data);
      setTotal(r.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [entity.key, page, q, active]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setQ(''); setActive(''); setMessage(''); setEditing(null); }, [entity.key]);

  const display = (field, row) => {
    const v = row[field.name];
    if (field.type === 'boolean') return <span className={`status ${v ? 'ok' : 'off'}`}>{v ? 'Ativo' : 'Inativo'}</span>;
    if (field.type === 'ref') {
      const ref = refOptions[field.ref]?.find((o) => o.id === v);
      return ref ? refLabel(ref) : v;
    }
    return v ?? '—';
  };

  async function remove(row) {
    const nome = row.code ? `${row.code} – ${row.name}` : `registro #${row.id}`;
    if (!window.confirm(`Excluir ${entity.singular.toLowerCase()} ${nome}?\n\nEsta operação não pode ser desfeita. Se o registro já estiver em uso, prefira inativá-lo.`)) return;
    try {
      await api(`/org/${entity.key}/${row.id}`, { method: 'DELETE' });
      setMessage(`${entity.singular} excluído(a).`);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>{entity.label}</h2>
          <p className="hint">{entity.sapConcept}</p>
        </div>
        {can('ADMIN.ORG.CREATE') && (
          <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo</button>
        )}
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por código ou nome"
          aria-label="Buscar"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <select aria-label="Situação" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}>
          <option value="">Todos</option>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
        </select>
        <span className="toolbar-count">{total} registro(s)</span>
      </div>

      {message && <div className="alert success" role="status">{message}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((f) => <th key={f.name}>{f.label}</th>)}
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={columns.length + 1} className="empty">Carregando…</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={columns.length + 1} className="empty">Nenhum registro encontrado.</td></tr>
            )}
            {!loading && rows.map((row) => (
              <tr key={row.id}>
                {columns.map((f) => <td key={f.name}>{display(f, row)}</td>)}
                <td className="actions">
                  {can('ADMIN.ORG.UPDATE') && <button className="btn btn-small" onClick={() => setEditing(row)}>Editar</button>}
                  {can('ADMIN.ORG.DELETE') && <button className="btn btn-small btn-danger" onClick={() => remove(row)}>Excluir</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="pager">
          <button className="btn btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
          <span>Página {page} de {pages}</span>
          <button className="btn btn-small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Próxima</button>
        </div>
      )}

      {editing && (
        <EntityForm
          entity={entity}
          record={editing}
          refOptions={refOptions}
          onClose={() => setEditing(null)}
          onSaved={(saved, isNew) => {
            setEditing(null);
            setMessage(`${entity.singular} ${saved.code ?? `#${saved.id}`} ${isNew ? 'criado(a)' : 'salvo(a)'}.`);
            load();
          }}
        />
      )}
    </section>
  );
}

function EntityForm({ entity, record, refOptions, onClose, onSaved }) {
  const isNew = !record.id;
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      entity.fields.map((f) => [f.name, record[f.name] ?? (f.type === 'boolean' ? f.default ?? true : '')]),
    ),
  );
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (name, value) => setValues((v) => ({ ...v, [name]: value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError('');
    try {
      const r = isNew
        ? await api(`/org/${entity.key}`, { method: 'POST', body: values })
        : await api(`/org/${entity.key}/${record.id}`, { method: 'PUT', body: values });
      onSaved(r.data, isNew);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} aria-label={`${isNew ? 'Novo' : 'Editar'} ${entity.singular}`}>
        <h3>{isNew ? `Novo(a) ${entity.singular.toLowerCase()}` : `Editar ${entity.singular.toLowerCase()}`}</h3>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <div className="form-grid">
          {entity.fields.map((f) => (
            <Field key={f.name} field={f} value={values[f.name]} error={errors[f.name]} options={refOptions[f.ref]} onChange={(v) => set(f.name, v)} />
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </div>
  );
}

function Field({ field, value, error, options, onChange }) {
  const id = `f-${field.name}`;
  let input;
  if (field.type === 'boolean') {
    return (
      <label className="checkbox">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {field.label}
      </label>
    );
  }
  if (field.type === 'ref') {
    input = (
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}>
        <option value="">Selecione…</option>
        {(options || []).map((o) => <option key={o.id} value={o.id}>{refLabel(o)}</option>)}
      </select>
    );
  } else if (field.type === 'timezone') {
    input = (
      <>
        <input id={id} list="timezones" value={value ?? ''} placeholder={PLACEHOLDERS.timezone} onChange={(e) => onChange(e.target.value)} />
        <datalist id="timezones">{TIMEZONES.map((tz) => <option key={tz} value={tz} />)}</datalist>
      </>
    );
  } else {
    const upper = ['code', 'country', 'currency', 'uf'].includes(field.type);
    const max = { country: 2, currency: 3, uf: 2, language: 5 }[field.type] ?? field.maxLength;
    input = (
      <input
        id={id}
        type={field.type === 'email' ? 'email' : 'text'}
        value={value ?? ''}
        maxLength={max}
        placeholder={PLACEHOLDERS[field.type]}
        style={upper ? { textTransform: 'uppercase' } : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{field.label}{field.required && <span className="req" aria-hidden> *</span>}</label>
      {input}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
