// Etapa 1 - Segurança básica: usuários, roles, permissões, sessões e auditoria.
// O escopo organizacional (user_org_scopes) e as telas de manutenção entram na Etapa 2.

const timestamps = (knex, t) => {
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
};

export async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('username', 40).notNullable().unique();
    t.string('full_name', 120).notNullable();
    t.string('email', 160).nullable().unique();
    t.string('password_hash', 255).notNullable();
    t.enu('status', ['ACTIVE', 'BLOCKED', 'INACTIVE']).notNullable().defaultTo('ACTIVE');
    t.boolean('must_change_password').notNullable().defaultTo(true);
    t.integer('failed_attempts').unsigned().notNullable().defaultTo(0);
    t.timestamp('locked_until').nullable();
    t.timestamp('last_login_at').nullable();
    t.timestamp('password_changed_at').nullable();
    timestamps(knex, t);
  });

  await knex.schema.createTable('roles', (t) => {
    t.increments('id');
    t.string('code', 40).notNullable().unique();
    t.string('name', 120).notNullable();
    t.string('description', 255).nullable();
    timestamps(knex, t);
  });

  await knex.schema.createTable('permissions', (t) => {
    t.increments('id');
    t.string('code', 80).notNullable().unique();
    t.string('module', 20).notNullable();
    t.string('description', 255).notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('role_permissions', (t) => {
    t.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.integer('permission_id').unsigned().notNullable().references('id').inTable('permissions').onDelete('CASCADE');
    t.primary(['role_id', 'permission_id']);
  });

  await knex.schema.createTable('user_roles', (t) => {
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.timestamp('assigned_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['user_id', 'role_id']);
  });

  // Guarda só o hash SHA-256 do token. O token em si fica apenas no cookie do navegador.
  await knex.schema.createTable('sessions', (t) => {
    t.increments('id');
    t.string('token_hash', 64).notNullable().unique();
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('expires_at').notNullable();
    t.string('ip', 45).nullable();
    t.string('user_agent', 255).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
    t.index(['expires_at']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id');
    t.timestamp('occurred_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('username', 40).nullable();
    t.string('action', 40).notNullable();
    t.string('entity', 60).nullable();
    t.string('entity_id', 60).nullable();
    t.enu('result', ['SUCCESS', 'DENIED', 'FAILURE']).notNullable();
    t.string('ip', 45).nullable();
    t.json('details').nullable();
    t.index(['occurred_at']);
    t.index(['entity', 'entity_id']);
    t.index(['user_id']);
    t.index(['action']);
  });
}

export async function down(knex) {
  for (const table of ['audit_logs', 'sessions', 'user_roles', 'role_permissions', 'permissions', 'roles', 'users']) {
    await knex.schema.dropTableIfExists(table);
  }
}
