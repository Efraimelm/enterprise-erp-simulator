import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Settings() {
  const { can } = useAuth();
  const [rows, setRows] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [status, setStatus] = useState({});
  const [error, setError] = useState('');
  const editable = can('ADMIN.SETTINGS.UPDATE');

  useEffect(() => {
    api('/settings')
      .then((r) => {
        setRows(r.data);
        setDrafts(Object.fromEntries(r.data.map((s) => [s.setting_key, s.value])));
      })
      .catch((e) => setError(e.message));
  }, []);

  async function save(key) {
    setStatus((s) => ({ ...s, [key]: { saving: true } }));
    try {
      const r = await api(`/settings/${key}`, { method: 'PUT', body: { value: drafts[key] } });
      setRows((rs) => rs.map((x) => (x.setting_key === key ? { ...x, ...r.data } : x)));
      setStatus((s) => ({ ...s, [key]: { ok: 'Salvo.' } }));
    } catch (e) {
      setStatus((s) => ({ ...s, [key]: { error: e.details?.[0]?.message || e.message } }));
    }
  }

  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!rows) return <div className="empty" role="status">Carregando…</div>;

  return (
    <>
      <div className="page-header">
        <h1>Parâmetros gerais</h1>
        <p className="hint">Valores padrão de idioma, fuso, moeda e formatos. Cada empresa pode ter os seus no cadastro de empresas.</p>
      </div>
      <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Parâmetro</th><th>Valor</th><th>Descrição</th><th aria-label="Ações" /></tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const st = status[s.setting_key] || {};
                const changed = drafts[s.setting_key] !== s.value;
                return (
                  <tr key={s.setting_key}>
                    <td><strong>{s.label}</strong><div className="hint small">{s.setting_key}</div></td>
                    <td>
                      {s.options ? (
                        <select aria-label={s.label} disabled={!editable} value={drafts[s.setting_key]} onChange={(e) => setDrafts({ ...drafts, [s.setting_key]: e.target.value })}>
                          {s.options.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input aria-label={s.label} disabled={!editable} value={drafts[s.setting_key]} onChange={(e) => setDrafts({ ...drafts, [s.setting_key]: e.target.value })} />
                      )}
                      {st.error && <div className="field-error">{st.error}</div>}
                      {st.ok && !changed && <div className="field-ok">{st.ok}</div>}
                    </td>
                    <td className="hint">{s.description}</td>
                    <td className="actions">
                      {editable && <button className="btn btn-small btn-primary" disabled={!changed || st.saving} onClick={() => save(s.setting_key)}>Salvar</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
