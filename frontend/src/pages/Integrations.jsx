// Administração → Integrações: clientes e chaves de API, webhooks, eventos e logs.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Alert, Field, Modal, Pager, Select, codeName, errorText, fmtDate, useList, useLookup } from '../components/ui.jsx';

const TABS = [['clients', 'Clientes e chaves de API'], ['webhooks', 'Webhooks'], ['events', 'Eventos'], ['logs', 'Logs']];
const D_STATUS = { PENDING: ['Pendente', 'warn'], SUCCESS: ['Entregue', 'ok'], FAILED: ['Falhou (vai tentar de novo)', 'warn'], DEAD: ['Desistiu', 'bad'] };

export default function Integrations() {
  const [tab, setTab] = useState('clients');
  const [secret, setSecret] = useState(null); // { title, value, hint }
  return (
    <>
      <div className="page-header">
        <h1>Integrações</h1>
        <p className="hint">
          API própria do simulador (não é API SAP). Clientes de integração (ex.: n8n, Power BI) leem com chave de API e recebem eventos por webhook assinado.
          {' '}<a href="/api/docs" target="_blank" rel="noreferrer">Abrir a documentação (Swagger)</a>
        </p>
      </div>
      {secret && (
        <div className="alert success secret" role="status">
          <div><strong>{secret.title}:</strong> <code>{secret.value}</code><div className="small">{secret.hint}</div></div>
          <div className="secret-actions">
            <button className="btn btn-small" onClick={() => navigator.clipboard?.writeText(secret.value)}>Copiar</button>
            <button className="btn btn-small" onClick={() => setSecret(null)}>Fechar</button>
          </div>
        </div>
      )}
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'clients' && <Clients onSecret={setSecret} />}
      {tab === 'webhooks' && <Webhooks onSecret={setSecret} />}
      {tab === 'events' && <Events />}
      {tab === 'logs' && <Logs />}
    </>
  );
}

function Clients({ onSecret }) {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState({});
  const load = () => api('/integration/clients').then((r) => setRows(r.data)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { load(); }, []);
  const editable = can('ADMIN.INTEGRATION.MAINTAIN');

  async function newKey(c) {
    const name = window.prompt('Nome da nova chave (ex.: n8n produção):');
    if (!name) return;
    try { const r = await api(`/integration/clients/${c.id}/keys`, { method: 'POST', body: { name } }); onSecret({ title: `Chave de API de ${c.full_name}`, value: r.data.apiKey, hint: 'Ela aparece só agora. Guarde em uma credencial do n8n (Header Auth: Authorization = Bearer <chave>).' }); load(); }
    catch (e) { setMsg({ error: errorText(e) }); }
  }
  async function revoke(k) {
    if (!window.confirm(`Revogar a chave ${k.prefix} (${k.name})? Quem usa essa chave perde o acesso na hora.`)) return;
    try { await api(`/integration/keys/${k.id}/revoke`, { method: 'POST' }); setMsg({ ok: 'Chave revogada.' }); load(); } catch (e) { setMsg({ error: errorText(e) }); }
  }

  return (
    <section className="card">
      <Alert error={msg.error} ok={msg.ok} />
      <div className="card-header">
        <p className="hint">Cada cliente é um usuário técnico (sem senha) com roles e escopo próprios. As chaves são <strong>somente leitura</strong> nesta versão.</p>
        {editable && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Novo cliente</button>}
      </div>
      {!rows && <p className="empty">Carregando…</p>}
      {rows?.length === 0 && <p className="empty">Nenhum cliente de integração. Crie um para o n8n.</p>}
      {rows?.map((c) => (
        <div key={c.id} className="subcard">
          <strong>{c.full_name}</strong> <span className="hint small">({c.username})</span>
          <div>{c.roles.map((r) => <span key={r} className="chip">{r}</span>)}{c.scopes.map((s) => <span key={s} className="chip">{s}</span>)}</div>
          <table>
            <thead><tr><th>Chave</th><th>Nome</th><th>Criada</th><th>Último uso</th><th>Status</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {c.keys.map((k) => (
                <tr key={k.id}>
                  <td><code>erp_{k.prefix}_…</code></td><td>{k.name}</td><td>{fmtDate(k.created_at)}</td><td>{fmtDate(k.last_used_at)}</td>
                  <td><span className={`status ${k.status === 'ACTIVE' ? 'ok' : 'off'}`}>{{ ACTIVE: 'Ativa', REVOKED: 'Revogada', EXPIRED: 'Expirada' }[k.status]}</span></td>
                  <td className="actions">{editable && k.status === 'ACTIVE' && <button className="btn btn-small btn-danger" onClick={() => revoke(k)}>Revogar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {editable && <button className="btn btn-small" onClick={() => newKey(c)}>+ Nova chave</button>}
        </div>
      ))}
      {creating && <NewClient onClose={() => setCreating(false)} onCreated={(r) => { setCreating(false); onSecret({ title: `Chave de API de ${r.username}`, value: r.apiKey, hint: 'Ela aparece só agora. No n8n: credencial "Header Auth" com Name = Authorization e Value = Bearer <chave>.' }); load(); }} />}
    </section>
  );
}

function NewClient({ onClose, onCreated }) {
  const plants = useLookup('/org/plants?pageSize=100');
  const [name, setName] = useState('n8n Copiloto');
  const [scope, setScope] = useState('ALL');
  const [err, setErr] = useState('');
  async function save() {
    try {
      const scopes = scope === 'ALL' ? [{ type: 'ALL' }] : [{ type: 'PLANT', plant_id: Number(scope) }];
      onCreated((await api('/integration/clients', { method: 'POST', body: { name, roles: ['INTEGRATION_READONLY'], scopes } })).data);
    } catch (e) { setErr(errorText(e)); }
  }
  return (
    <Modal title="Novo cliente de integração" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Criar e gerar chave</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Nome" required><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Escopo" hint="Centros que o cliente pode ler"><Select value={scope} placeholder="Todos os centros" onChange={(v) => setScope(v || 'ALL')} options={plants.map(codeName)} /></Field>
      </div>
      <p className="hint small">Role: <strong>INTEGRATION_READONLY</strong> (lê MM, SD, estrutura e KPIs). Para outras combinações, ajuste as roles do usuário técnico em Usuários.</p>
    </Modal>
  );
}

function Webhooks({ onSecret }) {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [types, setTypes] = useState([]);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState({});
  const load = () => api('/integration/webhooks').then((r) => setRows(r.data)).catch((e) => setMsg({ error: e.message }));
  useEffect(() => { load(); api('/integration/event-types').then((r) => setTypes(r.data)).catch(() => {}); }, []);
  const editable = can('ADMIN.INTEGRATION.MAINTAIN');

  async function test(w) {
    setMsg({});
    try {
      const r = (await api(`/integration/webhooks/${w.id}/test`, { method: 'POST' })).data;
      setMsg(r.status === 'SUCCESS' ? { ok: `Teste entregue (HTTP ${r.last_status_code}).` } : { error: `Teste falhou: ${r.last_error ?? r.status}. O ERP tentará de novo automaticamente.` });
      load();
    } catch (e) { setMsg({ error: errorText(e) }); }
  }
  async function rotate(w) {
    if (!window.confirm('Gerar um novo segredo? O atual deixa de valer: atualize o receptor (n8n).')) return;
    try { onSecret({ title: `Novo segredo do webhook ${w.name}`, value: (await api(`/integration/webhooks/${w.id}/rotate-secret`, { method: 'POST' })).data.secret, hint: 'Use no receptor para conferir X-ERP-Signature (HMAC-SHA256 de "timestamp.corpo").' }); }
    catch (e) { setMsg({ error: errorText(e) }); }
  }

  return (
    <section className="card">
      <Alert error={msg.error} ok={msg.ok} />
      <div className="card-header">
        <p className="hint">O ERP envia um POST JSON assinado (cabeçalho <code>X-ERP-Signature</code>) a cada evento escolhido, com novas tentativas em 1 min, 5 min, 30 min, 2 h e 6 h.</p>
        {editable && <button className="btn btn-primary" onClick={() => setEditing({})}>+ Novo webhook</button>}
      </div>
      <table>
        <thead><tr><th>Nome</th><th>URL</th><th>Eventos</th><th>Entregas</th><th>Ativo</th><th aria-label="Ações" /></tr></thead>
        <tbody>
          {rows?.length === 0 && <tr><td colSpan={6} className="empty">Nenhum webhook.</td></tr>}
          {rows?.map((w) => (
            <tr key={w.id}>
              <td><strong>{w.name}</strong></td><td className="small">{w.url}</td>
              <td>{w.events.map((e) => <span key={e} className="chip">{e === '*' ? 'todos' : e}</span>)}</td>
              <td className="small">{Object.entries(w.deliveries).map(([s, n]) => `${D_STATUS[s][0]}: ${n}`).join(' · ') || '—'}</td>
              <td>{w.is_active ? 'Sim' : 'Não'}</td>
              <td className="actions">
                {editable && <button className="btn btn-small" onClick={() => test(w)}>Testar</button>}
                {editable && <button className="btn btn-small" onClick={() => setEditing(w)}>Editar</button>}
                {editable && <button className="btn btn-small" onClick={() => rotate(w)}>Novo segredo</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && <WebhookForm hook={editing} types={types} onClose={() => setEditing(null)} onSaved={(r) => { setEditing(null); if (r.secret) onSecret({ title: `Segredo do webhook ${r.name}`, value: r.secret, hint: 'Ele aparece só agora. Cole no receptor (n8n) para conferir a assinatura.' }); load(); }} />}
    </section>
  );
}

function WebhookForm({ hook, types, onClose, onSaved }) {
  const isNew = !hook.id;
  const [f, setF] = useState({ name: hook.name ?? 'n8n local', url: hook.url ?? 'http://localhost:5678/webhook/erp-eventos', events: hook.events ?? ['*'], is_active: hook.is_active ?? true });
  const [err, setErr] = useState('');
  const toggle = (t, on) => setF({ ...f, events: on ? [...f.events.filter((e) => e !== '*'), t] : f.events.filter((e) => e !== t) });
  async function save() {
    try {
      const r = isNew ? await api('/integration/webhooks', { method: 'POST', body: { name: f.name, url: f.url, events: f.events } }) : await api(`/integration/webhooks/${hook.id}`, { method: 'PUT', body: f });
      onSaved(r.data);
    } catch (e) { setErr(errorText(e)); }
  }
  return (
    <Modal title={isNew ? 'Novo webhook' : `Editar ${hook.name}`} onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Salvar</button></>}>
      <Alert error={err} />
      <div className="form-grid">
        <Field label="Nome" required><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="URL do receptor" required hint="ex.: webhook do n8n"><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
      </div>
      <fieldset>
        <legend>Eventos</legend>
        <label className="checkbox"><input type="checkbox" checked={f.events.includes('*')} onChange={(e) => setF({ ...f, events: e.target.checked ? ['*'] : [] })} /> <strong>Todos</strong></label>
        {!f.events.includes('*') && types.map((t) => (
          <label key={t.type} className="checkbox"><input type="checkbox" checked={f.events.includes(t.type)} onChange={(e) => toggle(t.type, e.target.checked)} /> <code>{t.type}</code> <span className="hint small">{t.description}</span></label>
        ))}
      </fieldset>
      {!isNew && <label className="checkbox"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Ativo</label>}
    </Modal>
  );
}

function Events() {
  const { can } = useAuth();
  const list = useList('/integration/events', { type: '', status: '' });
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState({});
  async function retry(d) {
    try { const r = (await api(`/integration/deliveries/${d.id}/retry`, { method: 'POST' })).data; setMsg({ ok: `Reenvio: ${D_STATUS[r.status][0]}.` }); list.reload(); }
    catch (e) { setMsg({ error: errorText(e) }); }
  }
  return (
    <section className="card">
      <Alert error={msg.error || list.error} ok={msg.ok} />
      <div className="toolbar">
        <select aria-label="Status da entrega" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">Todas as entregas</option>{Object.entries(D_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="btn btn-small" onClick={list.reload}>Atualizar</button>
      </div>
      <table>
        <thead><tr><th>Quando</th><th>Evento</th><th>Entregas</th><th aria-label="Ações" /></tr></thead>
        <tbody>
          {list.data?.data.length === 0 && <tr><td colSpan={4} className="empty">Nenhum evento ainda.</td></tr>}
          {list.data?.data.map((e) => (
            <tr key={e.id}>
              <td className="nowrap">{fmtDate(e.occurred_at)}</td><td><code>{e.event_type}</code></td>
              <td>{e.deliveries.length === 0 ? <span className="hint small">nenhuma assinatura</span> : e.deliveries.map((d) => (
                <div key={d.id} className="small">
                  <span className={`status ${D_STATUS[d.status][1]}`}>{D_STATUS[d.status][0]}</span> {d.subscription} · {d.attempts} tentativa(s){d.last_status_code ? ` · HTTP ${d.last_status_code}` : ''}{d.last_error ? ` · ${d.last_error}` : ''}
                  {can('ADMIN.INTEGRATION.MAINTAIN') && ['FAILED', 'DEAD'].includes(d.status) && <button className="link" onClick={() => retry(d)}> reenviar</button>}
                </div>
              ))}</td>
              <td className="actions"><button className="btn btn-small" onClick={() => setOpen(e)}>Ver dados</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
      {open && <Modal title={open.event_type} onClose={() => setOpen(null)}><p className="hint small">id {open.event_id}</p><pre>{JSON.stringify(open.payload, null, 2)}</pre></Modal>}
    </section>
  );
}

function Logs() {
  const list = useList('/integration/logs', { direction: '', errors: '' }, 50);
  return (
    <section className="card">
      <Alert error={list.error} />
      <div className="toolbar">
        <select aria-label="Direção" value={list.filters.direction} onChange={(e) => list.setFilter('direction', e.target.value)}>
          <option value="">Entrada e saída</option><option value="IN">Entrada (chamadas à API)</option><option value="OUT">Saída (webhooks)</option>
        </select>
        <label className="checkbox"><input type="checkbox" checked={list.filters.errors === 'true'} onChange={(e) => list.setFilter('errors', e.target.checked ? 'true' : '')} /> Só erros</label>
      </div>
      <table>
        <thead><tr><th>Quando</th><th>Direção</th><th>Quem</th><th>Método</th><th>Rota / destino</th><th>Status</th><th>Tempo</th></tr></thead>
        <tbody>
          {list.data?.data.length === 0 && <tr><td colSpan={7} className="empty">Nenhum registro.</td></tr>}
          {list.data?.data.map((l) => (
            <tr key={l.id} className={l.error || l.status_code >= 400 ? 'row-warn' : ''}>
              <td className="nowrap">{fmtDate(l.created_at)}</td><td>{l.direction === 'IN' ? 'Entrada' : 'Saída'}</td>
              <td>{l.key_name ? `${l.key_name} (${l.key_prefix})` : l.subscription_name ?? '—'}</td><td>{l.method}</td>
              <td className="small">{l.target}</td><td>{l.status_code ?? '—'}{l.error && <div className="hint small">{l.error}</div>}</td><td>{l.duration_ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data && <Pager page={list.page} pageSize={list.pageSize} total={list.data.total} onPage={list.setPage} />}
    </section>
  );
}
