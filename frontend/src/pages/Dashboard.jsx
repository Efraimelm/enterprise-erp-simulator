import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { roadmap } from '../modules.js';

const COUNTERS = [
  { key: 'companies', label: 'Empresas' },
  { key: 'plants', label: 'Centros' },
  { key: 'storage-locations', label: 'Depósitos' },
  { key: 'sales-areas', label: 'Áreas de vendas' },
  { key: 'purchasing-organizations', label: 'Org. de compras' },
  { key: 'purchasing-groups', label: 'Grupos de compradores' },
];

const STATUS = { done: 'Concluída', next: 'Próxima', planned: 'Planejada' };

export default function Dashboard() {
  const { user, can } = useAuth();
  const [counts, setCounts] = useState({});

  useEffect(() => {
    if (!can('ADMIN.ORG.READ')) return;
    Promise.all(COUNTERS.map((c) => api(`/org/${c.key}?pageSize=1&is_active=true`).then((r) => [c.key, r.total])))
      .then((pairs) => setCounts(Object.fromEntries(pairs)))
      .catch(() => {});
  }, [can]);

  return (
    <>
      <div className="page-header">
        <h1>Olá, {user.full_name.split(' ')[0]}</h1>
        <p className="hint">Comércio Forte Ltda · empresa fictícia de demonstração</p>
      </div>

      {can('ADMIN.ORG.READ') && (
        <section className="tiles" aria-label="Estrutura organizacional ativa">
          {COUNTERS.map((c) => (
            <Link key={c.key} to={`/admin/estrutura/${c.key}`} className="tile">
              <span className="tile-value">{counts[c.key] ?? '…'}</span>
              <span className="tile-label">{c.label}</span>
            </Link>
          ))}
        </section>
      )}

      <section className="card">
        <div className="card-header"><h2>Roadmap do projeto</h2></div>
        <ol className="roadmap">
          {roadmap.map((r) => (
            <li key={r.stage} className={r.status}>
              <span className="roadmap-stage">{r.stage}</span>
              <div>
                <strong>{r.title}</strong> <span className={`status ${r.status === 'done' ? 'ok' : r.status === 'next' ? 'warn' : 'off'}`}>{STATUS[r.status]}</span>
                <div className="hint">{r.detail}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card note">
        <h2>O que é real e o que é simulado</h2>
        <ul>
          <li><strong>Implementado:</strong> login seguro, permissões validadas no backend, auditoria e cadastro da estrutura organizacional.</li>
          <li><strong>Simulado:</strong> todo o ERP. Os conceitos (empresa, centro, depósito, área de vendas) seguem o SAP S/4HANA, mas o sistema é próprio e não se conecta a nenhum SAP.</li>
          <li><strong>Planejado:</strong> módulos MM e SD, integração com n8n, assistente de IA e BI (ver roadmap).</li>
        </ul>
      </section>
    </>
  );
}
