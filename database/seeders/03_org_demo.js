// Estrutura organizacional da empresa fictícia de demonstração "Comércio Forte Ltda".
// Todos os códigos abaixo são DADOS de exemplo: podem ser alterados pela tela de administração.
// Idempotente: usa os códigos como chave e só insere o que ainda não existe.

async function upsert(knex, table, rows, keys) {
  if (rows.length) await knex(table).insert(rows).onConflict(keys).ignore();
}
const idOf = async (knex, table, where) => (await knex(table).where(where).first('id')).id;

export async function seed(knex) {
  await upsert(knex, 'companies', [
    {
      code: 'CF01', name: 'Comércio Forte', legal_name: 'Comércio Forte Ltda (empresa fictícia)', tax_id: '00.000.000/0001-00',
      city: 'São Paulo', country: 'BR', currency: 'BRL', language: 'pt-BR', timezone: 'America/Sao_Paulo',
    },
  ], ['code']);
  const cf01 = await idOf(knex, 'companies', { code: 'CF01' });

  await upsert(knex, 'plants', [
    { code: 'CF10', name: 'Matriz São Paulo', company_id: cf01, city: 'São Paulo', state: 'SP' },
    { code: 'CF20', name: 'CD Campinas', company_id: cf01, city: 'Campinas', state: 'SP' },
  ], ['code']);
  const cf10 = await idOf(knex, 'plants', { code: 'CF10' });
  const cf20 = await idOf(knex, 'plants', { code: 'CF20' });

  await upsert(knex, 'storage_locations', [
    { plant_id: cf10, code: '0001', name: 'Almoxarifado' },
    { plant_id: cf10, code: '0002', name: 'Expedição' },
    { plant_id: cf20, code: '0001', name: 'Armazém geral' },
    { plant_id: cf20, code: '0002', name: 'Expedição' },
  ], ['plant_id', 'code']);

  await upsert(knex, 'sales_organizations', [{ code: 'CF10', name: 'Vendas Brasil', company_id: cf01, currency: 'BRL' }], ['code']);
  await upsert(knex, 'distribution_channels', [
    { code: '10', name: 'Varejo' },
    { code: '20', name: 'Atacado' },
  ], ['code']);
  await upsert(knex, 'divisions', [
    { code: '01', name: 'Alimentos' },
    { code: '02', name: 'Bebidas' },
  ], ['code']);

  const so = await idOf(knex, 'sales_organizations', { code: 'CF10' });
  const channels = await knex('distribution_channels').pluck('id');
  const divisions = await knex('divisions').pluck('id');
  await upsert(
    knex,
    'sales_areas',
    channels.flatMap((c) => divisions.map((d) => ({ sales_organization_id: so, distribution_channel_id: c, division_id: d }))),
    ['sales_organization_id', 'distribution_channel_id', 'division_id'],
  );

  await upsert(knex, 'purchasing_organizations', [{ code: 'CF10', name: 'Compras Brasil', company_id: cf01 }], ['code']);
  const po = await idOf(knex, 'purchasing_organizations', { code: 'CF10' });
  await upsert(knex, 'purchasing_org_plants', [
    { purchasing_organization_id: po, plant_id: cf10 },
    { purchasing_organization_id: po, plant_id: cf20 },
  ], ['purchasing_organization_id', 'plant_id']);

  await upsert(knex, 'purchasing_groups', [
    { code: '001', name: 'Compras de alimentos', email: 'alimentos@comercioforte.exemplo' },
    { code: '002', name: 'Compras de bebidas', email: 'bebidas@comercioforte.exemplo' },
  ], ['code']);
}
