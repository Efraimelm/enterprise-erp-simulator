import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api.js';
import { useAuth } from '../auth.jsx';

const MODULES = { ADMIN: 'Administração', MM: 'MM · Materiais', SD: 'SD · Vendas' };

export default function Roles() {
  const { can } = useAuth();
  const [roles, setRoles] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [selected, setSelected] = useState(null); // code
  const [editing, setEditing] = useState(null); // {} novo | role
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = () =>
    api('/admin/roles')
      .then((r) => { setRoles(r.data); setSelected((s) => s ?? r.data[0]?.code); })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api('/admin/permissions').then((r) => setPermissions(r.data)).catch((e) => setError(e.message));
  }, []);

  const current = roles?.find((r) => r.code === selected);
  const byModule = useMemo(() => groupBy(permissions), [permissions]);

  async function remove(role) {
    if (!window.confirm(`Excluir a role ${role.code}?\n\nEsta operação não pode ser desfeita.`)) return;
    try {
      await api(`/admin/roles/${role.id}`, { method: 'DELETE' });
      setMessage(`Role ${role.code} excluída.`);
      setSelected(null);
      load();
    } catch (e) { setError(e.message); }
  }

  if (error && !roles) return <div className="alert error" role="alert">{error}</div>;
  if (!roles) return <div className="empty" role="status">Carregando…</div>;

  return (
    <>
      <div className="page-header">
        <h1>Roles e permissões</h1>
        <p className="hint">
          Uma role reúne permissões de uma função (ex.: Comprador). As roles de sistema são fixas. Para outras combinações,
          crie uma role personalizada com código começando por <code>Z_</code>, como no SAP.
        </p>
      </div>
      {message && <div className="alert success" role="status">{message}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="org-layout">
        <nav className="subnav" aria-label="Roles">
          {roles.map((r) => (
            <button key={r.code} className={`subnav-item subnav-button ${r.code === selected ? 'active' : ''}`} onClick={() => setSelected(r.code)}>
              {r.code}
              <span className="hint small"> · {r.user_count} usuário(s)</span>
            </button>
          ))}
          {can('ADMIN.ROLE.MAINTAIN') && (
            <div className="subnav-footer"><button className="btn btn-small btn-primary" onClick={() => setEditing({})}>+ Nova role</button></div>
          )}
        </nav>

        {current && (
          <section className="card">
            <div className="card-header">
              <div>
                <h2>{current.code} — {current.name} {current.is_system ? <span className="tag">sistema</span> : <span className="tag">personalizada</span>}</h2>
                <p className="hint">{current.description}</p>
              </div>
              {!current.is_system && can('ADMIN.ROLE.MAINTAIN') && (
                <div className="row-actions">
                  <button className="btn btn-small" onClick={() => setEditing(current)}>Editar</button>
                  <button className="btn btn-small btn-danger" onClick={() => remove(current)}>Excluir</button>
                </div>
              )}
            </div>
            <PermissionMatrix byModule={byModule} value={current.permissions} readOnly />
          </section>
        )}
      </div>

      {editing && (
        <RoleForm
          role={editing}
          byModule={byModule}
          onClose={() => setEditing(null)}
          onSaved={(r, isNew) => { setEditing(null); setMessage(`Role ${r.code} ${isNew ? 'criada' : 'salva'}.`); setSelected(r.code); load(); }}
        />
      )}
    </>
  );
}

function groupBy(permissions) {
  const out = {};
  for (const p of permissions) {
    const object = p.code.split('.')[1];
    out[p.module] ??= {};
    (out[p.module][object] ??= []).push(p);
  }
  return out;
}

function PermissionMatrix({ byModule, value, onChange, readOnly, allowed }) {
  const toggle = (code, on) => onChange(on ? [...value, code] : value.filter((c) => c !== code));
  return (
    <div className="perm-matrix">
      {Object.entries(byModule).map(([module, objects]) => (
        <div key={module} className="perm-module">
          <h4>{MODULES[module] ?? module}</h4>
          {Object.entries(objects).map(([object, perms]) => (
            <div key={object} className="perm-row">
              <span className="perm-object">{object.replace('_', ' ')}</span>
              <span className="perm-actions">
                {perms.map((p) => {
                  const action = p.code.split('.').slice(2).join('.');
                  const on = value.includes(p.code);
                  if (readOnly) return <span key={p.code} className={`perm ${on ? 'on' : ''}`} title={p.description}>{action}</span>;
                  const locked = allowed && !allowed.has(p.code);
                  return (
                    <label key={p.code} className={`perm perm-check ${on ? 'on' : ''}`} title={locked ? 'Você não possui esta permissão' : p.description}>
                      <input type="checkbox" checked={on} disabled={locked} onChange={(e) => toggle(p.code, e.target.checked)} /> {action}
                    </label>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function RoleForm({ role, byModule, onClose, onSaved }) {
  const { user } = useAuth();
  const isNew = !role.id;
  const [form, setForm] = useState({ code: role.code || 'Z_', name: role.name || '', description: role.description || '', permissions: role.permissions || [] });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const allowed = useMemo(() => new Set(user.permissions), [user]);

  async function submit(e) {
    e.preventDefault();
    setErrors({}); setFormError('');
    try {
      const { code, ...rest } = form;
      const r = isNew
        ? await api('/admin/roles', { method: 'POST', body: { code, ...rest } })
        : await api(`/admin/roles/${role.id}`, { method: 'PUT', body: rest });
      onSaved(r.data, isNew);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setFormError(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal modal-wide" onSubmit={submit} aria-label={isNew ? 'Nova role' : `Editar ${role.code}`}>
        <h3>{isNew ? 'Nova role personalizada' : `Editar ${role.code}`}</h3>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <div className="form-grid">
          <div className={`field ${errors.code ? 'has-error' : ''}`}>
            <label htmlFor="r-code">Código</label>
            <input id="r-code" value={form.code} disabled={!isNew} style={{ textTransform: 'uppercase' }} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            {errors.code && <span className="field-error">{errors.code}</span>}
          </div>
          <div className={`field ${errors.name ? 'has-error' : ''}`}>
            <label htmlFor="r-name">Nome</label>
            <input id="r-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            {errors.name && <span className="field-error">{errors.name}</span>}
          </div>
          <div className="field">
            <label htmlFor="r-desc">Descrição</label>
            <input id="r-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
        </div>
        <p className="hint small">Só é possível incluir permissões que você mesmo possui.</p>
        <PermissionMatrix byModule={byModule} value={form.permissions} allowed={allowed} onChange={(v) => setForm({ ...form, permissions: v })} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Salvar</button>
        </div>
      </form>
    </div>
  );
}
