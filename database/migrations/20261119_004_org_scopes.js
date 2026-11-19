// Etapa 2 - Escopo organizacional do usuário e roles de sistema.
//
// user_org_scopes define ONDE o usuário pode atuar:
//   ALL      todas as empresas e centros
//   COMPANY  uma empresa inteira (todos os centros dela, inclusive os criados depois)
//   PLANT    um centro específico
// O escopo efetivo é a união das linhas do usuário. Sem nenhuma linha, o usuário não vê
// dados de empresas e centros (só cadastros globais, como canais e setores).

export async function up(knex) {
  await knex.schema.alterTable('roles', (t) => {
    // Roles de sistema vêm do seed e não podem ser alteradas nem excluídas pela tela.
    t.boolean('is_system').notNullable().defaultTo(false).after('description');
  });

  await knex.schema.createTable('user_org_scopes', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enu('scope_type', ['ALL', 'COMPANY', 'PLANT']).notNullable();
    t.integer('company_id').unsigned().nullable().references('id').inTable('companies').onDelete('RESTRICT');
    t.integer('plant_id').unsigned().nullable().references('id').inTable('plants').onDelete('RESTRICT');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.index(['user_id']);
  });

  // Garante a coerência do tipo com as colunas preenchidas (MariaDB 10.2+ e MySQL 8.0.16+ aplicam CHECK).
  await knex.raw(`
    ALTER TABLE user_org_scopes ADD CONSTRAINT chk_user_org_scopes_type CHECK (
      (scope_type = 'ALL'     AND company_id IS NULL     AND plant_id IS NULL) OR
      (scope_type = 'COMPANY' AND company_id IS NOT NULL AND plant_id IS NULL) OR
      (scope_type = 'PLANT'   AND plant_id IS NOT NULL   AND company_id IS NULL)
    )`);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('user_org_scopes');
  await knex.schema.alterTable('roles', (t) => t.dropColumn('is_system'));
}
