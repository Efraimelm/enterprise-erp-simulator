// Etapa 4 - SD: clientes, condições comerciais, pedidos de venda, entregas, faturamento,
// contas a receber e pagamentos (simulados). Desenho completo em docs/sd-design.md.

const QTY = [15, 3];
const MONEY = [15, 2];

const stamps = (knex, t) => {
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
};
const who = (t) => {
  t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
  t.integer('updated_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
};
const fk = (t, column, table, nullable = false) => {
  const c = t.integer(column).unsigned();
  (nullable ? c.nullable() : c.notNullable()).references('id').inTable(table).onDelete('RESTRICT');
};
const user = (t, column, nullable = true) => {
  const c = t.integer(column).unsigned();
  (nullable ? c.nullable() : c.notNullable()).references('id').inTable('users').onDelete(nullable ? 'SET NULL' : 'RESTRICT');
};

export async function up(knex) {
  await knex.schema.createTable('customers', (t) => {
    t.increments('id');
    t.string('code', 10).notNullable().unique();
    t.string('name', 80).notNullable();
    t.string('legal_name', 120).notNullable();
    t.string('tax_id', 20).nullable();
    t.string('street', 120).nullable();
    t.string('city', 60).nullable();
    t.string('state', 2).nullable();
    t.string('zip', 9).nullable();
    t.string('ship_to_street', 120).nullable();
    t.string('ship_to_city', 60).nullable();
    t.string('ship_to_state', 2).nullable();
    t.string('ship_to_zip', 9).nullable();
    t.string('contact_name', 80).nullable();
    t.string('email', 160).nullable();
    t.string('phone', 20).nullable();
    fk(t, 'payment_term_id', 'payment_terms', true);
    t.enu('status', ['ACTIVE', 'BLOCKED', 'INACTIVE']).notNullable().defaultTo('ACTIVE');
    stamps(knex, t);
    who(t);
  });

  await knex.schema.createTable('customer_sales_areas', (t) => {
    t.increments('id');
    fk(t, 'customer_id', 'customers');
    fk(t, 'sales_area_id', 'sales_areas');
    t.unique(['customer_id', 'sales_area_id'], { indexName: 'uq_customer_sales_area' });
  });

  // Registro de condição de preço: cliente > canal > geral, com validade.
  await knex.schema.createTable('product_prices', (t) => {
    t.increments('id');
    fk(t, 'material_id', 'materials');
    fk(t, 'sales_organization_id', 'sales_organizations');
    fk(t, 'distribution_channel_id', 'distribution_channels', true);
    fk(t, 'customer_id', 'customers', true);
    t.decimal('price', ...MONEY).notNullable();
    t.date('valid_from').notNullable();
    t.date('valid_to').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    stamps(knex, t);
    who(t);
    t.index(['material_id', 'sales_organization_id']);
  });

  await knex.schema.createTable('price_discounts', (t) => {
    t.increments('id');
    fk(t, 'sales_organization_id', 'sales_organizations');
    fk(t, 'distribution_channel_id', 'distribution_channels', true);
    fk(t, 'customer_id', 'customers', true);
    fk(t, 'material_id', 'materials', true);
    t.decimal('percent', 5, 2).notNullable();
    t.string('description', 120).nullable();
    t.date('valid_from').notNullable();
    t.date('valid_to').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    stamps(knex, t);
    who(t);
    t.index(['sales_organization_id']);
  });

  await knex.schema.createTable('sales_orders', (t) => {
    t.increments('id');
    t.string('number', 10).notNullable().unique();
    fk(t, 'customer_id', 'customers');
    fk(t, 'sales_organization_id', 'sales_organizations');
    fk(t, 'distribution_channel_id', 'distribution_channels');
    fk(t, 'division_id', 'divisions');
    fk(t, 'plant_id', 'plants');
    fk(t, 'payment_term_id', 'payment_terms', true);
    t.string('currency', 3).notNullable();
    t.enu('status', ['DRAFT', 'PENDING_APPROVAL', 'CONFIRMED', 'IN_DELIVERY', 'PARTIALLY_DELIVERED', 'DELIVERED', 'BILLED', 'CANCELLED']).notNullable();
    t.boolean('allow_partial').notNullable().defaultTo(true);
    t.date('requested_date').notNullable();
    t.string('customer_reference', 40).nullable();
    t.string('ship_to', 255).nullable();
    t.string('notes', 255).nullable();
    t.decimal('total_gross_list', ...MONEY).notNullable().defaultTo(0); // soma de qtd × preço, antes do desconto
    t.decimal('total_discount', ...MONEY).notNullable().defaultTo(0);
    t.decimal('total_net', ...MONEY).notNullable().defaultTo(0);
    t.decimal('total_tax', ...MONEY).notNullable().defaultTo(0);
    t.decimal('total_gross', ...MONEY).notNullable().defaultTo(0);
    user(t, 'created_by', false);
    t.timestamp('submitted_at').nullable();
    user(t, 'approved_by');
    t.timestamp('approved_at').nullable();
    t.boolean('auto_approved').notNullable().defaultTo(false);
    t.timestamp('confirmed_at').nullable();
    t.string('status_note', 255).nullable();
    stamps(knex, t);
    t.index(['plant_id', 'status']);
    t.index(['customer_id']);
  });

  await knex.schema.createTable('sales_order_items', (t) => {
    t.increments('id');
    t.integer('sales_order_id').unsigned().notNullable().references('id').inTable('sales_orders').onDelete('CASCADE');
    t.integer('item_no').unsigned().notNullable();
    fk(t, 'material_id', 'materials');
    fk(t, 'storage_location_id', 'storage_locations');
    t.decimal('quantity', ...QTY).notNullable();
    t.decimal('confirmed_qty', ...QTY).notNullable().defaultTo(0); // reservado pelo ATP
    t.decimal('delivered_qty', ...QTY).notNullable().defaultTo(0);
    t.decimal('billed_qty', ...QTY).notNullable().defaultTo(0);
    t.decimal('unit_price', ...MONEY).notNullable();
    t.string('price_source', 20).notNullable(); // CUSTOMER, CHANNEL, GENERAL
    t.decimal('discount_pct', 5, 2).notNullable().defaultTo(0);
    t.decimal('discount_amount', ...MONEY).notNullable().defaultTo(0);
    t.decimal('net_amount', ...MONEY).notNullable();
    fk(t, 'tax_code_id', 'tax_codes', true);
    t.decimal('tax_rate', 5, 2).notNullable().defaultTo(0);
    t.decimal('tax_amount', ...MONEY).notNullable().defaultTo(0);
    t.unique(['sales_order_id', 'item_no'], { indexName: 'uq_so_item' });
  });

  await knex.schema.createTable('deliveries', (t) => {
    t.increments('id');
    t.string('number', 10).notNullable().unique();
    fk(t, 'sales_order_id', 'sales_orders');
    fk(t, 'plant_id', 'plants');
    t.enu('status', ['CREATED', 'PICKED', 'POSTED']).notNullable().defaultTo('CREATED');
    t.string('ship_to', 255).nullable();
    t.string('material_doc_number', 10).nullable();
    user(t, 'created_by', false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    user(t, 'picked_by');
    t.timestamp('picked_at').nullable();
    user(t, 'posted_by');
    t.timestamp('posted_at').nullable();
    t.index(['plant_id', 'status']);
  });

  await knex.schema.createTable('delivery_items', (t) => {
    t.increments('id');
    t.integer('delivery_id').unsigned().notNullable().references('id').inTable('deliveries').onDelete('CASCADE');
    t.integer('sales_order_item_id').unsigned().notNullable().references('id').inTable('sales_order_items').onDelete('RESTRICT');
    fk(t, 'material_id', 'materials');
    fk(t, 'storage_location_id', 'storage_locations');
    t.decimal('quantity', ...QTY).notNullable();
    t.decimal('picked_qty', ...QTY).nullable();
  });

  await knex.schema.createTable('billing_documents', (t) => {
    t.increments('id');
    t.string('number', 10).notNullable().unique();
    t.enu('type', ['INVOICE', 'CANCELLATION']).notNullable();
    t.enu('status', ['ACTIVE', 'CANCELLED']).notNullable().defaultTo('ACTIVE');
    fk(t, 'sales_order_id', 'sales_orders');
    fk(t, 'delivery_id', 'deliveries');
    fk(t, 'customer_id', 'customers');
    fk(t, 'plant_id', 'plants');
    t.integer('reference_billing_id').unsigned().nullable().references('id').inTable('billing_documents').onDelete('RESTRICT');
    t.string('currency', 3).notNullable();
    t.date('billing_date').notNullable();
    t.decimal('total_net', ...MONEY).notNullable();
    t.decimal('total_tax', ...MONEY).notNullable();
    t.decimal('total_gross', ...MONEY).notNullable();
    t.string('reason', 255).nullable();
    user(t, 'created_by', false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['plant_id', 'billing_date']);
    t.index(['delivery_id']);
  });

  await knex.schema.createTable('billing_items', (t) => {
    t.increments('id');
    t.integer('billing_document_id').unsigned().notNullable().references('id').inTable('billing_documents').onDelete('CASCADE');
    t.integer('sales_order_item_id').unsigned().notNullable().references('id').inTable('sales_order_items').onDelete('RESTRICT');
    t.integer('delivery_item_id').unsigned().notNullable().references('id').inTable('delivery_items').onDelete('RESTRICT');
    fk(t, 'material_id', 'materials');
    t.decimal('quantity', ...QTY).notNullable();
    t.decimal('unit_price', ...MONEY).notNullable();
    t.decimal('discount_amount', ...MONEY).notNullable();
    t.decimal('net_amount', ...MONEY).notNullable();
    t.decimal('tax_rate', 5, 2).notNullable();
    t.decimal('tax_amount', ...MONEY).notNullable();
  });

  await knex.schema.createTable('accounts_receivable', (t) => {
    t.increments('id');
    t.integer('billing_document_id').unsigned().notNullable().unique().references('id').inTable('billing_documents').onDelete('RESTRICT');
    fk(t, 'customer_id', 'customers');
    fk(t, 'plant_id', 'plants');
    t.string('currency', 3).notNullable();
    t.decimal('amount', ...MONEY).notNullable();
    t.decimal('paid_amount', ...MONEY).notNullable().defaultTo(0);
    t.date('issue_date').notNullable();
    t.date('due_date').notNullable();
    t.enu('status', ['OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']).notNullable().defaultTo('OPEN');
    stamps(knex, t);
    t.index(['status', 'due_date']);
    t.index(['customer_id']);
  });
  await knex.raw('ALTER TABLE accounts_receivable ADD CONSTRAINT chk_ar_paid CHECK (paid_amount >= 0 AND paid_amount <= amount)');

  await knex.schema.createTable('payments', (t) => {
    t.increments('id');
    t.string('number', 10).notNullable().unique();
    t.integer('receivable_id').unsigned().notNullable().references('id').inTable('accounts_receivable').onDelete('RESTRICT');
    t.decimal('amount', ...MONEY).notNullable();
    t.date('payment_date').notNullable();
    t.enu('method', ['PIX', 'BOLETO', 'TRANSFER']).notNullable();
    t.string('notes', 255).nullable();
    user(t, 'created_by', false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  for (const table of [
    'payments', 'accounts_receivable', 'billing_items', 'billing_documents', 'delivery_items', 'deliveries',
    'sales_order_items', 'sales_orders', 'price_discounts', 'product_prices', 'customer_sales_areas', 'customers',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
