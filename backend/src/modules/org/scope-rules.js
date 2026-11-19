// Regras de escopo organizacional por cadastro da estrutura.
//
//   read(qb, scope)          restringe a consulta ao que o usuário pode VER
//   write(row, scope, trx)   o usuário pode CRIAR/ALTERAR/EXCLUIR esse registro?
//
// Princípio: quem tem um CENTRO mantém o que é do centro (depósitos, atribuição à org. de compras).
// Quem tem a EMPRESA inteira mantém o que é da empresa (centros, organizações de vendas e compras).
// Criar uma EMPRESA nova exige o escopo ALL. Cadastros globais (canais, setores, grupos de
// compradores) não dependem de escopo, só de permissão.

const ids = (set) => [...set];

const salesOrgCompany = async (salesOrgId, trx) =>
  (await trx('sales_organizations').where({ id: salesOrgId }).first('company_id'))?.company_id;

export const scopeRules = {
  companies: {
    read: (qb, s) => qb.whereIn('id', ids(s.companyIds)),
    write: (row, s) => row.id !== undefined && s.fullCompanyIds.has(row.id),
  },
  plants: {
    read: (qb, s) => qb.whereIn('id', ids(s.plantIds)),
    write: (row, s) => s.fullCompanyIds.has(row.company_id),
  },
  storage_locations: {
    read: (qb, s) => qb.whereIn('plant_id', ids(s.plantIds)),
    write: (row, s) => s.plantIds.has(row.plant_id),
  },
  sales_organizations: {
    read: (qb, s) => qb.whereIn('company_id', ids(s.companyIds)),
    write: (row, s) => s.fullCompanyIds.has(row.company_id),
  },
  purchasing_organizations: {
    read: (qb, s) => qb.whereIn('company_id', ids(s.companyIds)),
    write: (row, s) => s.fullCompanyIds.has(row.company_id),
  },
  purchasing_org_plants: {
    read: (qb, s) => qb.whereIn('plant_id', ids(s.plantIds)),
    write: (row, s) => s.plantIds.has(row.plant_id),
  },
  sales_areas: {
    read: (qb, s, db) =>
      qb.whereIn('sales_organization_id', db('sales_organizations').whereIn('company_id', ids(s.companyIds)).select('id')),
    write: async (row, s, trx) => s.fullCompanyIds.has(await salesOrgCompany(row.sales_organization_id, trx)),
  },
  // Globais: sem restrição de escopo.
  distribution_channels: null,
  divisions: null,
  purchasing_groups: null,
};

export function applyReadScope(qb, table, scope, db) {
  const rule = scopeRules[table];
  if (!rule || scope.all) return qb;
  return rule.read(qb, scope, db);
}

export async function canWrite(table, row, scope, trx) {
  const rule = scopeRules[table];
  if (!rule || scope.all) return true;
  return !!(await rule.write(row, scope, trx));
}
