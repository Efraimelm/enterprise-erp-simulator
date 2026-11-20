// Etapa 6 - Integração: usuários técnicos e chaves de API, idempotência, eventos (outbox),
// webhooks, logs de integração e registro das consultas ao assistente de IA.

export async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    // Usuário técnico = cliente de integração. Não tem senha utilizável e não entra pela tela de login.
    t.boolean('is_technical').notNullable().defaultTo(false).after('status');
  });

  await knex.schema.createTable('api_keys', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('name', 80).notNullable();
    t.string('prefix', 12).notNullable().unique();
    t.string('key_hash', 64).notNullable(); // SHA-256 da chave completa
    t.timestamp('expires_at').nullable();
    t.timestamp('revoked_at').nullable();
    t.timestamp('last_used_at').nullable();
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('idempotency_keys', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('idem_key', 100).notNullable();
    t.string('method', 10).notNullable();
    t.string('path', 255).notNullable();
    t.string('request_hash', 64).notNullable();
    t.enu('state', ['IN_PROGRESS', 'DONE']).notNullable();
    t.integer('status_code').nullable();
    t.text('response_body', 'mediumtext').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['user_id', 'idem_key', 'method', 'path'], { indexName: 'uq_idempotency' });
    t.index(['created_at']);
  });

  await knex.schema.createTable('webhook_subscriptions', (t) => {
    t.increments('id');
    t.string('name', 80).notNullable();
    t.string('url', 500).notNullable();
    t.json('events').notNullable(); // lista de tipos de evento, ou ["*"]
    t.text('secret_encrypted').notNullable(); // AES-256-GCM
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });

  await knex.schema.createTable('integration_events', (t) => {
    t.bigIncrements('id');
    t.string('event_id', 36).notNullable().unique(); // UUID enviado ao receptor
    t.string('event_type', 60).notNullable();
    t.string('dedupe_key', 100).nullable(); // evita repetir o mesmo alerta (ex.: estoque baixo) em pouco tempo
    t.integer('plant_id').unsigned().nullable().references('id').inTable('plants').onDelete('SET NULL');
    t.json('payload').notNullable();
    t.timestamp('occurred_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.timestamp('dispatched_at').nullable(); // quando as entregas foram geradas
    t.index(['event_type', 'occurred_at']);
    t.index(['dedupe_key', 'occurred_at']);
    t.index(['dispatched_at']);
  });

  await knex.schema.createTable('webhook_deliveries', (t) => {
    t.bigIncrements('id');
    t.bigInteger('event_id').unsigned().notNullable().references('id').inTable('integration_events').onDelete('CASCADE');
    t.integer('subscription_id').unsigned().notNullable().references('id').inTable('webhook_subscriptions').onDelete('CASCADE');
    t.enu('status', ['PENDING', 'SUCCESS', 'FAILED', 'DEAD']).notNullable().defaultTo('PENDING');
    t.integer('attempts').unsigned().notNullable().defaultTo(0);
    t.timestamp('next_attempt_at').notNullable().defaultTo(knex.fn.now());
    t.integer('last_status_code').nullable();
    t.string('last_error', 255).nullable();
    t.timestamp('delivered_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['event_id', 'subscription_id'], { indexName: 'uq_delivery' });
    t.index(['status', 'next_attempt_at']);
  });

  await knex.schema.createTable('integration_logs', (t) => {
    t.bigIncrements('id');
    t.enu('direction', ['IN', 'OUT']).notNullable(); // IN = chamada à API por chave; OUT = webhook enviado
    t.integer('api_key_id').unsigned().nullable().references('id').inTable('api_keys').onDelete('SET NULL');
    t.integer('subscription_id').unsigned().nullable().references('id').inTable('webhook_subscriptions').onDelete('SET NULL');
    t.bigInteger('delivery_id').unsigned().nullable();
    t.string('method', 10).notNullable();
    t.string('target', 500).notNullable(); // rota chamada (IN) ou URL de destino (OUT)
    t.integer('status_code').nullable();
    t.integer('duration_ms').nullable();
    t.string('error', 255).nullable();
    t.timestamp('created_at', { precision: 3 }).notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP(3)'));
    t.index(['created_at']);
    t.index(['direction', 'status_code']);
  });

  await knex.schema.createTable('ai_queries', (t) => {
    t.bigIncrements('id');
    t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('question', 500).notNullable();
    t.enu('mode', ['LLM', 'DETERMINISTIC']).notNullable();
    t.json('tools_used').notNullable();
    t.json('sources').notNullable();
    t.integer('duration_ms').nullable();
    t.string('error', 255).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'created_at']);
  });
}

export async function down(knex) {
  for (const table of ['ai_queries', 'integration_logs', 'webhook_deliveries', 'integration_events', 'webhook_subscriptions', 'idempotency_keys', 'api_keys']) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex.schema.alterTable('users', (t) => t.dropColumn('is_technical'));
}
