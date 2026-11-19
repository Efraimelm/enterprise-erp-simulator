// Etapa 1 - Estrutura organizacional (inspirada nos conceitos do SAP Enterprise Structure).
// Todos os códigos são dados cadastrados, nunca fixos no código-fonte.
//
//   companies (empresa) 1─N plants (centro) 1─N storage_locations (depósito)
//   companies 1─N sales_organizations ─┐
//   distribution_channels ─────────────┼─ sales_areas (área de vendas = org + canal + setor)
//   divisions ─────────────────────────┘
//   companies 1─N purchasing_organizations N─N plants (purchasing_org_plants)
//   purchasing_groups (grupo de compradores, independente)

const audit = (knex, t) => {
  t.boolean('is_active').notNullable().defaultTo(true);
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
  t.integer('updated_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
};

const fk = (t, column, table) =>
  t.integer(column).unsigned().notNullable().references('id').inTable(table).onDelete('RESTRICT');

export async function up(knex) {
  await knex.schema.createTable('companies', (t) => {
    t.increments('id');
    t.string('code', 4).notNullable().unique();
    t.string('name', 80).notNullable();
    t.string('legal_name', 120).notNullable();
    t.string('tax_id', 20).nullable();
    t.string('city', 60).nullable();
    t.string('country', 2).notNullable();
    t.string('currency', 3).notNullable();
    t.string('language', 5).notNullable();
    t.string('timezone', 64).notNullable();
    audit(knex, t);
  });

  await knex.schema.createTable('plants', (t) => {
    t.increments('id');
    t.string('code', 4).notNullable().unique();
    t.string('name', 80).notNullable();
    fk(t, 'company_id', 'companies');
    t.string('city', 60).nullable();
    t.string('state', 2).nullable();
    audit(knex, t);
    t.index(['company_id']);
  });

  await knex.schema.createTable('storage_locations', (t) => {
    t.increments('id');
    fk(t, 'plant_id', 'plants');
    t.string('code', 4).notNullable();
    t.string('name', 80).notNullable();
    audit(knex, t);
    t.unique(['plant_id', 'code']);
  });

  await knex.schema.createTable('sales_organizations', (t) => {
    t.increments('id');
    t.string('code', 4).notNullable().unique();
    t.string('name', 80).notNullable();
    fk(t, 'company_id', 'companies');
    t.string('currency', 3).notNullable();
    audit(knex, t);
  });

  await knex.schema.createTable('distribution_channels', (t) => {
    t.increments('id');
    t.string('code', 2).notNullable().unique();
    t.string('name', 80).notNullable();
    audit(knex, t);
  });

  await knex.schema.createTable('divisions', (t) => {
    t.increments('id');
    t.string('code', 2).notNullable().unique();
    t.string('name', 80).notNullable();
    audit(knex, t);
  });

  await knex.schema.createTable('sales_areas', (t) => {
    t.increments('id');
    fk(t, 'sales_organization_id', 'sales_organizations');
    fk(t, 'distribution_channel_id', 'distribution_channels');
    fk(t, 'division_id', 'divisions');
    audit(knex, t);
    t.unique(['sales_organization_id', 'distribution_channel_id', 'division_id'], { indexName: 'uq_sales_areas' });
  });

  await knex.schema.createTable('purchasing_organizations', (t) => {
    t.increments('id');
    t.string('code', 4).notNullable().unique();
    t.string('name', 80).notNullable();
    fk(t, 'company_id', 'companies');
    audit(knex, t);
  });

  await knex.schema.createTable('purchasing_org_plants', (t) => {
    t.increments('id');
    fk(t, 'purchasing_organization_id', 'purchasing_organizations');
    fk(t, 'plant_id', 'plants');
    audit(knex, t);
    t.unique(['purchasing_organization_id', 'plant_id'], { indexName: 'uq_purchasing_org_plants' });
  });

  await knex.schema.createTable('purchasing_groups', (t) => {
    t.increments('id');
    t.string('code', 3).notNullable().unique();
    t.string('name', 80).notNullable();
    t.string('email', 160).nullable();
    audit(knex, t);
  });
}

export async function down(knex) {
  for (const table of [
    'purchasing_groups', 'purchasing_org_plants', 'purchasing_organizations', 'sales_areas',
    'divisions', 'distribution_channels', 'sales_organizations', 'storage_locations', 'plants', 'companies',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
