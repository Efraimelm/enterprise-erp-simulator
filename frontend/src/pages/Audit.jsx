import { useEffect, useState } from 'react';
import { api, toQuery } from '../api.js';

const RESULT_CLASS = { SUCCESS: 'ok', DENIED: 'warn', FAILURE: 'bad' };
const RESULT_LABEL = { SUCCESS: 'Sucesso', DENIED: 'Negado', FAILURE: 'Falha' };

export default function Audit() {
  const [filters, setFilters] = useState({ username: '', action: '', result: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const pageSize = 50;

  useEffect(() => {
    setError('');
    api(`/audit${toQuery({ ...filters, page, pageSize })}`).then(setData).catch((e) => setError(e.message));
  }, [filters, page]);

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <>
      <div className="page-header">
        <h1>Auditoria</h1>
        <p className="hint">Quem fez o quê, quando e com qual resultado. Somente leitura. Senhas e tokens nunca são registrados.</p>
      </div>
      <section className="card">
        <div className="toolbar">
          <input placeholder="Usuário" aria-label="Usuário" value={filters.username} onChange={(e) => setFilter('username', e.target.value)} />
          <select aria-label="Ação" value={filters.action} onChange={(e) => setFilter('action', e.target.value)}>
            <option value="">Todas as ações</option>
            {['LOGIN', 'LOGOUT', 'CHANGE_PASSWORD', 'CREATE', 'UPDATE', 'DELETE', 'ACCESS'].map((a) => <option key={a}>{a}</option>)}
          </select>
          <select aria-label="Resultado" value={filters.result} onChange={(e) => setFilter('result', e.target.value)}>
            <option value="">Todos os resultados</option>
            {Object.entries(RESULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {data && <span className="toolbar-count">{data.total} evento(s)</span>}
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Objeto</th><th>Resultado</th><th>Detalhes</th></tr>
            </thead>
            <tbody>
              {!data && <tr><td colSpan={6} className="empty">Carregando…</td></tr>}
              {data?.data.length === 0 && <tr><td colSpan={6} className="empty">Nenhum evento.</td></tr>}
              {data?.data.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{new Date(r.occurred_at).toLocaleString('pt-BR')}</td>
                  <td>{r.username || '—'}</td>
                  <td>{r.action}</td>
                  <td>{r.entity ? `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''}` : '—'}</td>
                  <td><span className={`status ${RESULT_CLASS[r.result]}`}>{RESULT_LABEL[r.result]}</span></td>
                  <td>
                    {r.details ? (
                      <details><summary>ver</summary><pre>{JSON.stringify(r.details, null, 2)}</pre></details>
                    ) : '—'}
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
      </section>
    </>
  );
}
