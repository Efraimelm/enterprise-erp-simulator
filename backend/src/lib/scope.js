// Escopo organizacional: em quais empresas e centros o usuário pode atuar.
//
//   all             true se o usuário tem o escopo ALL
//   fullCompanyIds  empresas inteiras (escopo COMPANY). Permite manter a estrutura da empresa
//   plantIds        centros acessíveis: os do escopo PLANT + todos os centros das empresas inteiras
//   companyIds      empresas visíveis: as inteiras + as empresas dos centros acessíveis (só leitura)
import { db } from '../db.js';

export async function loadScope(userId, trx = db) {
  const rows = await trx('user_org_scopes as s')
    .leftJoin('companies as c', 'c.id', 's.company_id')
    .leftJoin('plants as p', 'p.id', 's.plant_id')
    .where('s.user_id', userId)
    .select('s.scope_type as type', 's.company_id', 's.plant_id', 'c.code as company_code', 'c.name as company_name', 'p.code as plant_code', 'p.name as plant_name')
    .orderBy(['s.scope_type', 'c.code', 'p.code']);

  const entries = rows.map((r) => ({
    type: r.type,
    company_id: r.company_id,
    plant_id: r.plant_id,
    label:
      r.type === 'ALL' ? 'Todas as empresas e centros'
        : r.type === 'COMPANY' ? `Empresa ${r.company_code} – ${r.company_name}`
          : `Centro ${r.plant_code} – ${r.plant_name}`,
  }));

  if (rows.some((r) => r.type === 'ALL')) {
    return { all: true, entries, fullCompanyIds: new Set(), plantIds: new Set(), companyIds: new Set() };
  }

  const fullCompanyIds = rows.filter((r) => r.type === 'COMPANY').map((r) => r.company_id);
  const directPlants = rows.filter((r) => r.type === 'PLANT').map((r) => r.plant_id);
  const plants = await trx('plants')
    .where((qb) => qb.whereIn('id', directPlants).orWhereIn('company_id', fullCompanyIds))
    .select('id', 'company_id');

  return {
    all: false,
    entries,
    fullCompanyIds: new Set(fullCompanyIds),
    plantIds: new Set(plants.map((p) => p.id)),
    companyIds: new Set([...fullCompanyIds, ...plants.map((p) => p.company_id)]),
  };
}

/** O escopo "alvo" cabe dentro do escopo de quem está atribuindo? (evita escalada de privilégio) */
export function scopeWithin(target, granter, plantCompany) {
  if (granter.all) return true;
  if (target.type === 'ALL') return false;
  if (target.type === 'COMPANY') return granter.fullCompanyIds.has(target.company_id);
  return granter.plantIds.has(target.plant_id) || granter.fullCompanyIds.has(plantCompany?.get(target.plant_id));
}
