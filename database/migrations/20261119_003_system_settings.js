// Etapa 1 - Parâmetros gerais do sistema (idioma, fuso, moeda e formatos padrão).
// As regras de validação de cada chave ficam em backend/src/modules/settings/definitions.js.

export async function up(knex) {
  await knex.schema.createTable('system_settings', (t) => {
    t.string('setting_key', 60).primary();
    t.string('value', 255).notNullable();
    t.string('description', 255).notNullable();
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('updated_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('system_settings');
}
