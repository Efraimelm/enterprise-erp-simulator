// Etapa 3 - MM: numeração, configuração de compras, materiais, fornecedores, estoque,
// requisições, pedidos, recebimentos e inventário. Desenho completo em docs/mm-design.md.

const QTY = [15, 3]; // quantidades: até 999.999.999.999,999
const MONEY = [15, 2]; // valores: até 9.999.999.999.999,99

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
const STATUS = ['ACTIVE', 'BLOCKED', 'INACTIVE'];

export async function up(knex) {
  await knex.schema.createTable('document_sequences', (t) => {
    t.string('doc_type', 20).primary();
    t.string('description', 80).notNullable();
    t.string('prefix', 4).notNullable();
    t.integer('length').unsigned().notNullable();
    t.bigInteger('next_number').unsigned().notNullable().defaultTo(1);
  });

  // Configuração de compras (mantida pela tela de configuração, como a estrutura organizacional).
  await knex.schema.createTable('tax_codes', (t) => {
    t.increments('id');
    t.string('code', 10).notNullable().unique();
    t.string('name', 80).notNullable();
    t.decimal('rate', 5, 2).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    stamps(knex, t);
    who(t);
  });
  await knex.schema.createTable('payment_terms', (t) => {
    t.increments('id');
    t.string('code', 4).notNullable().unique();
    t.string('name', 80).notNullable();
    t.integer('days').unsigned().notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    stamps(knex, t);
    who(t);
  });

  await knex.schema.createTable('materials', (t) => {
    t.increments('id');
    t.string('code', 18).notNullable().unique();
    t.string('description', 120).notNullable();
    t.enu('material_type', ['HAWA', 'ROH', 'HIBE']).notNullable(); // mercadoria, matéria-prima, consumo
    t.string('category', 60).nullable();
    t.string('base_unit', 3).notNullable();
    t.decimal('reference_price', ...MONEY).notNullable().defaultTo(0);
    t.enu('status', STATUS).notNullable().defaultTo('ACTIVE');
    stamps(knex, t);
    who(t);
    t.index(['status']);
  });

  await knex.schema.createTable('material_plant_data', (t) => {
    t.increments('id');
    fk(t, 'material_id', 'materials');
    fk(t, 'plant_id', 'plants');
    fk(t, 'default_storage_location_id', 'storage_locations', true);
    fk(t, 'purchasing_group_id', 'purchasing_groups', true);
    t.decimal('min_stock', ...QTY).notNullable().defaultTo(0);
    t.decimal('reorder_point', ...QTY).notNullable().defaultTo(0);
    t.decimal('max_stock', ...QTY).notNullable().defaultTo(0);
    stamps(knex, t);
    who(t);
    t.unique(['material_id', 'plant_id'], { indexName: 'uq_material_plant' });
  });

  await knex.schema.createTable('suppliers', (t) => {
    t.increments('id');
    t.string('code', 10).notNullable().unique();
    t.string('name', 80).notNullable();
    t.string('legal_name', 120).notNullable();
    t.string('tax_id', 20).nullable();
    t.string('street', 120).nullable();
    t.string('city', 60).nullable();
    t.string('state', 2).nullable();
    t.string('zip', 9).nullable();
    t.string('contact_name', 80).nullable();
    t.string('email', 160).nullable();
    t.string('phone', 20).nullable();
    fk(t, 'payment_term_id', 'payment_terms', true);
    t.decimal('overdelivery_tolerance_pct', 5, 2).notNullable().defaultTo(0);
    t.enu('status', STATUS).notNullable().defaultTo('ACTIVE');
    stamps(knex, t);
    who(t);
  });

  await knex.schema.createTable('supplier_materials', (t) => {
    t.increments('id');
    fk(t, 'supplier_id', 'suppliers');
    fk(t, 'material_id', 'materials');
    t.decimal('net_price', ...MONEY).notNullable();
    t.integer('lead_time_days').unsigned().notNullable().defaultTo(0);
    t.string('supplier_material_code', 30).nullable();
    stamps(knex, t);
    who(t);
    t.unique(['supplier_id', 'material_id'], { indexName: 'uq_supplier_material' });
  });

  await knex.schema.createTable('stock_balances', (t) => {
    t.increments('id');
    fk(t, 'material_id', 'materials');
    fk(t, 'plant_id', 'plants');
    fk(t, 'storage_location_id', 'storage_locations');
    t.decimal('physical_qty', ...QTY).notNullable().defaultTo(0);
    t.decimal('reserved_qty', ...QTY).notNullable().defaultTo(0);
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.unique(['material_id', 'storage_location_id'], { indexName: 'uq_stock_material_sloc' });
    t.index(['plant_id', 'material_id']);
  });
  await knex.raw('ALTER TABLE stock_balances ADD CONSTRAINT chk_stock_non_negative CHECK (physical_qty >= 0 AND reserved_qty >= 0)');

  await knex.schema.createTable('stock_movements', (t) => {
    t.bigIncrements('id');
    t.string('doc_number', 10).notNullable();
    t.integer('line_no').unsigned().notNullable();
    t.string('movement_type', 3).notNullable();
    fk(t, 'material_id', 'materials');
    fk(t, 'plant_id', 'plants');
    fk(t, 'storage_location_id', 'storage_locations');
    t.decimal('quantity', ...QTY).notNullable(); // positivo = entrada, negativo = saída
    t.string('reason', 255).nullable();
    t.string('reference_type', 30).nullable(); // PURCHASE_ORDER, INVENTORY
    t.integer('reference_id').unsigned().nullable();
    t.integer('reference_item_id').unsigned().nullable();
    t.integer('posted_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('posted_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['doc_number', 'line_no'], { indexName: 'uq_movement_doc_line' });
    t.index(['material_id', 'plant_id']);
    t.index(['reference_type', 'reference_id']);
    t.index(['posted_at']);
  });

  await knex.schema.createTable('purchase_requisitions', (t) => {
    t.increments('id');
    t.string('number', 10).notNullable().unique();
    fk(t, 'plant_id', 'plants');
    t.integer('requester_id').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.enu('source', ['MANUAL', 'MRP']).notNullable().defaultTo('MANUAL');
    t.enu('status', ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED']).notNullable();
    t.string('justification', 255).notNullable();
    t.integer('decided_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('decided_at').nullable();
    t.string('decision_note', 255).nullable();
    stamps(knex, t);
    t.index(['plant_id', 'status']);
  });

  await knex.schema.createTable('purchase_orders', (t) => {
    t.increments('id');
    t.string('number', 10).notNullable().unique();
    fk(t, 'supplier_id', 'suppliers');
    fk(t, 'purchasing_organization_id', 'purchasing_organizations');
    fk(t, 'purchasing_group_id', 'purchasing_groups', true);
    fk(t, 'plant_id', 'plants');
    fk(t, 'payment_term_id', 'payment_terms', true);
    t.string('currency', 3).notNullable();
    t.enu('status', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).notNullable();
    t.date('delivery_date').notNullable();
    t.string('notes', 255).nullable();
    t.decimal('total_net', ...MONEY).notNullable().defaultTo(0);
    t.decimal('total_tax', ...MONEY).notNullable().defaultTo(0);
    t.decimal('total_gross', ...MONEY).notNullable().defaultTo(0);
    t.integer('created_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('submitted_at').nullable();
    t.integer('approved_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('approved_at').nullable();
    t.boolean('auto_approved').notNullable().defaultTo(false);
    t.timestamp('sent_at').nullable();
    t.string('status_note', 255).nullable();
    stamps(knex, t);
    t.index(['plant_id', 'status']);
    t.index(['supplier_id']);
  });

  await knex.schema.createTable('purchase_order_items', (t) => {
    t.increments('id');
    t.integer('purchase_order_id').unsigned().notNullable().references('id').inTable('purchase_orders').onDelete('CASCADE');
    t.integer('item_no').unsigned().notNullable();
    fk(t, 'material_id', 'materials');
    fk(t, 'storage_location_id', 'storage_locations');
    t.decimal('quantity', ...QTY).notNullable();
    t.decimal('received_qty', ...QTY).notNullable().defaultTo(0);
    t.decimal('unit_price', ...MONEY).notNullable();
    fk(t, 'tax_code_id', 'tax_codes', true);
    t.decimal('tax_rate', 5, 2).notNullable().defaultTo(0);
    t.decimal('net_amount', ...MONEY).notNullable();
    t.decimal('tax_amount', ...MONEY).notNullable();
    t.unique(['purchase_order_id', 'item_no'], { indexName: 'uq_po_item' });
  });

  await knex.schema.createTable('purchase_requisition_items', (t) => {
    t.increments('id');
    t.integer('requisition_id').unsigned().notNullable().references('id').inTable('purchase_requisitions').onDelete('CASCADE');
    t.integer('item_no').unsigned().notNullable();
    fk(t, 'material_id', 'materials');
    fk(t, 'storage_location_id', 'storage_locations', true);
    t.decimal('quantity', ...QTY).notNullable();
    t.date('need_date').notNullable();
    t.decimal('estimated_price', ...MONEY).notNullable().defaultTo(0);
    t.integer('purchase_order_item_id').unsigned().nullable().references('id').inTable('purchase_order_items').onDelete('SET NULL');
    t.unique(['requisition_id', 'item_no'], { indexName: 'uq_pr_item' });
  });

  await knex.schema.createTable('goods_receipts', (t) => {
    t.increments('id');
    t.string('doc_number', 10).notNullable().unique(); // = documento de material
    fk(t, 'purchase_order_id', 'purchase_orders');
    fk(t, 'plant_id', 'plants');
    t.string('notes', 255).nullable();
    t.integer('posted_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('posted_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('inventory_documents', (t) => {
    t.increments('id');
    t.string('doc_number', 10).notNullable().unique();
    fk(t, 'plant_id', 'plants');
    fk(t, 'storage_location_id', 'storage_locations');
    t.string('reason', 255).notNullable();
    t.string('material_doc_number', 10).nullable(); // documento 701/702 gerado (nulo se não houve diferença)
    t.integer('posted_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamp('posted_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('inventory_items', (t) => {
    t.increments('id');
    t.integer('inventory_document_id').unsigned().notNullable().references('id').inTable('inventory_documents').onDelete('CASCADE');
    fk(t, 'material_id', 'materials');
    t.decimal('book_qty', ...QTY).notNullable();
    t.decimal('counted_qty', ...QTY).notNullable();
    t.decimal('difference', ...QTY).notNullable();
  });
}

export async function down(knex) {
  for (const table of [
    'inventory_items', 'inventory_documents', 'goods_receipts', 'purchase_requisition_items', 'purchase_order_items',
    'purchase_orders', 'purchase_requisitions', 'stock_movements', 'stock_balances', 'supplier_materials', 'suppliers',
    'material_plant_data', 'materials', 'payment_terms', 'tax_codes', 'document_sequences',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
}
