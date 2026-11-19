import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, toQuery } from '../api.js';
import { useAuth } from '../auth.jsx';
import ScopeEditor from '../components/ScopeEditor.jsx';

const STATUS = {
  ACTIVE: ['Ativo', 'ok'],
  BLOCKED: ['Bloqueado', 'bad'],
  INACTIVE: ['Inativo', 'off'],
};

export default function Users() {
  const { can } = useAuth();
  const [filters, setFilters] = useState({ q: '', status: '', role: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null); // id do usuário aberto
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState(null); // { username, password } — senha provisória mostrada uma vez
  const pageSize = 20;

  const load = useCallback(() => {
    setError('');
    api(`/admin/users${toQuery({ ...filters, page, pageSize })}`).then(setData).catch((e) => setError(e.message));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api('/admin/roles').then((r) => setRoles(r.data)).catch(() => {}); }, []);

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <>
      <div className="page-header">
        <h1>Usuários</h1>
        <p className="hint">Quem acessa o ERP, com quais roles (o que pode fazer) e em qual escopo (onde pode fazer).</p>
      </div>

      {secret && <TemporaryPassword secret={secret} onClose={() => setSecret(null)} />}

      <section className="card">
        <div className="card-header">
          <div className="toolbar">
            <input type="search" placeholder="Buscar por usuário, nome ou e-mail" aria-label="Buscar" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
            <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">Todos os status</option>
              {Object.entries(STATUS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <select aria-label="Role" value={filters.role} onChange={(e) => setFilter('role', e.target.value)}>
              <option value="">Todas as roles</option>
              {roles.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
            </select>
          </div>
          {can('ADMIN.USER.CREATE') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Novo usuário</button>}
        </div>

        {error && <div className="alert error" role="alert">{error}</div>}

        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Usuário</th><th>Nome</th><th>Roles</th><th>Escopo</th><th>Status</th><th>Último acesso</th><th aria-label="Ações" /></tr>
            </thead>
            <tbody>
              {!data && <tr><td colSpan={7} className="empty">Carregando…</td></tr>}
              {data?.data.length === 0 && <tr><td colSpan={7} className="empty">Nenhum usuário encontrado.</td></tr>}
              {data?.data.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.username}</strong>{u.must_change_password && <div className="hint small">senha provisória</div>}</td>
                  <td>{u.full_name}<div className="hint small">{u.email}</div></td>
                  <td>{u.roles.map((r) => <span key={r.code} className="chip">{r.code}</span>)}</td>
                  <td>{u.scopes.length ? u.scopes.map((s) => <span key={s.label} className="chip">{s.label}</span>) : <span className="hint">nenhum</span>}</td>
                  <td>
                    <span className={`status ${STATUS[u.status][1]}`}>{STATUS[u.status][0]}</span>
                    {u.locked && <div className="hint small">travado por tentativas</div>}
                  </td>
                  <td className="nowrap">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('pt-BR') : '—'}</td>
                  <td className="actions"><button className="btn btn-small" onClick={() => setSelected(u.id)}>Abrir</button></td>
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
      </section>

      {creating && (
        <CreateUser
          roles={roles}
          onClose={() => setCreating(false)}
          onCreated={(r) => { setCreating(false); setSecret({ username: r.data.username, password: r.temporaryPassword }); load(); }}
        />
      )}
      {selected && (
        <UserDetail
          id={selected}
          roles={roles}
          onClose={() => setSelected(null)}
          onChanged={load}
          onSecret={setSecret}
        />
      )}
    </>
  );
}

function TemporaryPassword({ secret, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(secret.password); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div className="alert success secret" role="status">
      <div>
        <strong>Senha provisória de {secret.username}:</strong> <code>{secret.password}</code>
        <div className="small">Ela aparece só agora. Entregue ao usuário por um canal seguro. No primeiro login, ele vai ter de trocá-la.</div>
      </div>
      <div className="secret-actions">
        <button className="btn btn-small" onClick={copy}>{copied ? 'Copiada' : 'Copiar'}</button>
        <button className="btn btn-small" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}

function RolePicker({ roles, value, onChange, disabled }) {
  return (
    <fieldset className="role-picker" disabled={disabled}>
      <legend>Roles</legend>
      {roles.map((r) => (
        <label key={r.code} className="checkbox" title={r.description || ''}>
          <input
            type="checkbox"
            checked={value.includes(r.code)}
            onChange={(e) => onChange(e.target.checked ? [...value, r.code] : value.filter((c) => c !== r.code))}
          />
          <span><strong>{r.code}</strong> <span className="hint small">{r.name}</span></span>
        </label>
      ))}
    </fieldset>
  );
}

function CreateUser({ roles, onClose, onCreated }) {
  const { can } = useAuth();
  const [form, setForm] = useState({ username: '', full_name: '', email: '', roles: [], scopes: [] });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const canAssign = can('ADMIN.ROLE.ASSIGN');

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setErrors({}); setFormError('');
    try {
      const body = canAssign ? form : { username: form.username, full_name: form.full_name, email: form.email };
      onCreated(await api('/admin/users', { method: 'POST', body }));
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setFormError(err.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal modal-wide" onSubmit={submit} aria-label="Novo usuário">
        <h3>Novo usuário</h3>
        {formError && <div className="alert error" role="alert">{formError}</div>}
        <div className="form-grid">
          <TextField id="nu-username" label="Usuário" value={form.username} error={errors.username} onChange={(v) => setForm({ ...form, username: v.toLowerCase() })} required hint="ex.: maria.silva" />
          <TextField id="nu-name" label="Nome completo" value={form.full_name} error={errors.full_name} onChange={(v) => setForm({ ...form, full_name: v })} required />
          <TextField id="nu-email" label="E-mail (fictício)" type="email" value={form.email} error={errors.email} onChange={(v) => setForm({ ...form, email: v })} />
        </div>
        {canAssign ? (
          <div className="two-cols">
            <RolePicker roles={roles} value={form.roles} onChange={(v) => setForm({ ...form, roles: v })} />
            <ScopeEditor value={form.scopes} onChange={(v) => setForm({ ...form, scopes: v })} />
          </div>
        ) : <p className="hint">Você não tem a permissão ADMIN.ROLE.ASSIGN: o usuário será criado sem roles e sem escopo.</p>}
        <p className="hint small">O sistema gera uma senha provisória forte, que aparece uma única vez depois de salvar.</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Criando…' : 'Criar usuário'}</button>
        </div>
      </form>
    </div>
  );
}

function UserDetail({ id, roles, onClose, onChanged, onSecret }) {
  const { user: me, can } = useAuth();
  const [u, setU] = useState(null);
  const [profile, setProfile] = useState(null);
  const [userRoles, setUserRoles] = useState([]);
  const [scopes, setScopes] = useState([]);
  const [msg, setMsg] = useState({});
  const self = me.id === id;

  const apply = (data) => {
    setU(data);
    setProfile({ full_name: data.full_name, email: data.email || '' });
    setUserRoles(data.roles.map((r) => r.code));
    setScopes(data.scopes.map(({ type, company_id, plant_id }) => ({ type, ...(company_id ? { company_id } : {}), ...(plant_id ? { plant_id } : {}) })));
  };

  useEffect(() => { api(`/admin/users/${id}`).then((r) => apply(r.data)).catch((e) => setMsg({ error: e.message })); }, [id]);

  async function run(label, fn) {
    setMsg({});
    try {
      const r = await fn();
      if (r?.data) apply(r.data);
      if (r?.temporaryPassword) onSecret({ username: r.data.username, password: r.temporaryPassword });
      setMsg({ ok: label });
      onChanged();
    } catch (e) {
      setMsg({ error: e.details?.length ? e.details.map((d) => d.message).join(' ') : e.message });
    }
  }

  function changeStatus(status) {
    const reason = window.prompt(`Motivo para deixar ${u.username} como ${STATUS[status][0].toLowerCase()}:`);
    if (!reason) return;
    run('Status alterado.', () => api(`/admin/users/${id}/status`, { method: 'POST', body: { status, reason } }));
  }

  function resetPassword() {
    if (!window.confirm(`Gerar uma nova senha provisória para ${u.username}?\n\nA senha atual deixa de valer e as sessões abertas dele são encerradas.`)) return;
    run('Senha redefinida.', () => api(`/admin/users/${id}/reset-password`, { method: 'POST' }));
  }

  if (!u) {
    return (
      <div className="modal-backdrop"><div className="modal">{msg.error ? <div className="alert error">{msg.error}</div> : 'Carregando…'}</div></div>
    );
  }

  const canUpdate = can('ADMIN.USER.UPDATE');
  const canAssign = can('ADMIN.ROLE.ASSIGN') && !self;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-label={`Usuário ${u.username}`}>
        <div className="card-header">
          <div>
            <h3>{u.username} <span className={`status ${STATUS[u.status][1]}`}>{STATUS[u.status][0]}</span></h3>
            <p className="hint small">
              Criado em {new Date(u.created_at).toLocaleString('pt-BR')} · último acesso {u.last_login_at ? new Date(u.last_login_at).toLocaleString('pt-BR') : 'nunca'}
              {u.locked && ' · travado por tentativas'}
            </p>
          </div>
          <button className="btn btn-small" onClick={onClose}>Fechar</button>
        </div>

        {msg.error && <div className="alert error" role="alert">{msg.error}</div>}
        {msg.ok && <div className="alert success" role="status">{msg.ok}</div>}
        {self && <p className="hint">Este é o seu usuário: status, roles e escopo só podem ser alterados por outro administrador.</p>}

        <h4>Dados</h4>
        <div className="form-grid">
          <TextField id="ud-name" label="Nome completo" value={profile.full_name} disabled={!canUpdate} onChange={(v) => setProfile({ ...profile, full_name: v })} />
          <TextField id="ud-email" label="E-mail" type="email" value={profile.email} disabled={!canUpdate} onChange={(v) => setProfile({ ...profile, email: v })} />
        </div>
        {canUpdate && (
          <div className="row-actions">
            <button className="btn btn-small btn-primary" onClick={() => run('Dados salvos.', () => api(`/admin/users/${id}`, { method: 'PUT', body: profile }))}>Salvar dados</button>
            {!self && u.status !== 'ACTIVE' && <button className="btn btn-small" onClick={() => changeStatus('ACTIVE')}>Ativar</button>}
            {!self && u.status !== 'BLOCKED' && <button className="btn btn-small btn-danger" onClick={() => changeStatus('BLOCKED')}>Bloquear</button>}
            {!self && u.status !== 'INACTIVE' && <button className="btn btn-small btn-danger" onClick={() => changeStatus('INACTIVE')}>Inativar</button>}
            {!self && <button className="btn btn-small" onClick={resetPassword}>Redefinir senha</button>}
          </div>
        )}

        <div className="two-cols">
          <div>
            <RolePicker roles={roles} value={userRoles} onChange={setUserRoles} disabled={!canAssign} />
            {canAssign && <button className="btn btn-small btn-primary" onClick={() => run('Roles salvas.', () => api(`/admin/users/${id}/roles`, { method: 'PUT', body: { roles: userRoles } }))}>Salvar roles</button>}
          </div>
          <div>
            <ScopeEditor value={scopes} onChange={setScopes} disabled={!canAssign} />
            {canAssign && <button className="btn btn-small btn-primary" onClick={() => run('Escopo salvo.', () => api(`/admin/users/${id}/scopes`, { method: 'PUT', body: { scopes } }))}>Salvar escopo</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function TextField({ id, label, value, onChange, error, required, type = 'text', hint, disabled }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      <input id={id} type={type} value={value} placeholder={hint} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
