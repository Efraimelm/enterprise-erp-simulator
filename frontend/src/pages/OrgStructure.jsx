import { useEffect, useState } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import EntityPage from '../components/EntityPage.jsx';

export default function OrgStructure() {
  const { entity } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/org/meta').then((r) => setMeta(r.data)).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!meta) return <div className="empty" role="status">Carregando…</div>;
  if (!entity) return <Navigate to={`/admin/estrutura/${meta[0].key}`} replace />;

  const current = meta.find((m) => m.key === entity);
  if (!current) return <div className="empty">Cadastro não encontrado.</div>;

  return (
    <>
      <div className="page-header">
        <h1>Estrutura organizacional</h1>
        <p className="hint">Defina a empresa e onde ela compra, estoca e vende. Os códigos são dados configuráveis.</p>
      </div>
      <div className="org-layout">
        <nav className="subnav" aria-label="Cadastros da estrutura">
          {meta.map((m) => (
            <NavLink key={m.key} to={`/admin/estrutura/${m.key}`} className="subnav-item">{m.label}</NavLink>
          ))}
        </nav>
        <EntityPage key={current.key} entity={current} />
      </div>
    </>
  );
}
