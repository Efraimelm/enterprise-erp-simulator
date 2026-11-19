// Editor do escopo organizacional: "todas", empresas inteiras e/ou centros específicos.
// As listas de empresas e centros já chegam filtradas pelo escopo de quem está editando.
import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ScopeEditor({ value, onChange, disabled }) {
  const [companies, setCompanies] = useState([]);
  const [plants, setPlants] = useState([]);

  useEffect(() => {
    api('/org/companies?pageSize=100').then((r) => setCompanies(r.data)).catch(() => {});
    api('/org/plants?pageSize=100').then((r) => setPlants(r.data)).catch(() => {});
  }, []);

  const all = value.some((s) => s.type === 'ALL');
  const hasCompany = (id) => value.some((s) => s.type === 'COMPANY' && s.company_id === id);
  const hasPlant = (id) => value.some((s) => s.type === 'PLANT' && s.plant_id === id);

  const toggle = (item, on) => {
    const key = (s) => `${s.type}:${s.company_id ?? ''}:${s.plant_id ?? ''}`;
    onChange(on ? [...value.filter((s) => s.type !== 'ALL'), item] : value.filter((s) => key(s) !== key(item)));
  };

  return (
    <fieldset className="scope-editor" disabled={disabled}>
      <legend>Escopo organizacional</legend>
      <label className="checkbox">
        <input type="checkbox" checked={all} onChange={(e) => onChange(e.target.checked ? [{ type: 'ALL' }] : [])} />
        <strong>Todas as empresas e centros</strong>
      </label>
      {!all && companies.map((c) => (
        <div key={c.id} className="scope-company">
          <label className="checkbox">
            <input type="checkbox" checked={hasCompany(c.id)} onChange={(e) => toggle({ type: 'COMPANY', company_id: c.id }, e.target.checked)} />
            Empresa {c.code} – {c.name} <span className="hint small">(todos os centros)</span>
          </label>
          {!hasCompany(c.id) && (
            <div className="scope-plants">
              {plants.filter((p) => p.company_id === c.id).map((p) => (
                <label key={p.id} className="checkbox">
                  <input type="checkbox" checked={hasPlant(p.id)} onChange={(e) => toggle({ type: 'PLANT', plant_id: p.id }, e.target.checked)} />
                  Centro {p.code} – {p.name}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      {!all && value.length === 0 && <p className="hint small">Sem escopo, o usuário não vê dados de empresas e centros.</p>}
    </fieldset>
  );
}
