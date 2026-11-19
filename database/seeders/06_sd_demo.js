// Etapa 4 - Numeração do SD e dados de demonstração: clientes, áreas de venda, preços e descontos.
// Idempotente: só insere o que falta.

const SEQUENCES = [
  { doc_type: 'SALES_ORDER', description: 'Pedido de venda', prefix: '00', length: 10 },
  { doc_type: 'DELIVERY', description: 'Entrega', prefix: '80', length: 10 },
  { doc_type: 'BILLING', description: 'Fatura e estorno', prefix: '90', length: 10 },
  { doc_type: 'PAYMENT', description: 'Pagamento (simulado)', prefix: '14', length: 10 },
];

// [código, nome, razão social, cidade, UF, condição, canais]
const CUSTOMERS = [
  ['C0001', 'Mercado Bom Preço', 'Mercado Bom Preço Ltda (fictício)', 'São Paulo', 'SP', 'D30', ['10', '20']],
  ['C0002', 'Atacadão Paulista', 'Atacadão Paulista S.A. (fictício)', 'Guarulhos', 'SP', 'D60', ['20']],
  ['C0003', 'Padaria Pão Quente', 'Padaria Pão Quente ME (fictícia)', 'Campinas', 'SP', 'AV', ['10']],
];

// Preço geral por material na organização de vendas CF10 e preço de atacado (canal 20).
const PRICES = {
  'ALM-0001': [32.9, 29.9],
  'ALM-0002': [11.5, 10.2],
  'ALM-0003': [26.9, 24.5],
  'BEB-0001': [13.9, 12.4],
  'BEB-0002': [3.5, 2.9],
};

export async function seed(knex) {
  await knex('document_sequences').insert(SEQUENCES).onConflict('doc_type').ignore();

  const salesOrg = await knex('sales_organizations').where({ code: 'CF10' }).first('id');
  if (!salesOrg || (await knex('customers').first('id'))) return; // sem estrutura demo, ou já carregado

  const admin = await knex('users').where({ username: 'admin' }).first('id');
  const channel = Object.fromEntries((await knex('distribution_channels').select('id', 'code')).map((c) => [c.code, c.id]));
  const year = new Date().getFullYear();
  const validity = { valid_from: `${year - 1}-01-01`, valid_to: `${year + 5}-12-31` };

  for (const [code, name, legal, city, state, term, channels] of CUSTOMERS) {
    const termId = (await knex('payment_terms').where({ code: term }).first('id'))?.id ?? null;
    const [id] = await knex('customers').insert({
      code, name, legal_name: legal, city, state, ship_to_city: city, ship_to_state: state,
      email: `compras@${code.toLowerCase()}.exemplo`, payment_term_id: termId, created_by: admin?.id, updated_by: admin?.id,
    });
    const areas = await knex('sales_areas').where({ sales_organization_id: salesOrg.id }).whereIn('distribution_channel_id', channels.map((c) => channel[c])).pluck('id');
    if (areas.length) await knex('customer_sales_areas').insert(areas.map((a) => ({ customer_id: id, sales_area_id: a })));
  }

  for (const [materialCode, [general, wholesale]] of Object.entries(PRICES)) {
    const material = await knex('materials').where({ code: materialCode }).first('id');
    if (!material) continue;
    await knex('product_prices').insert([
      { material_id: material.id, sales_organization_id: salesOrg.id, price: general, ...validity, created_by: admin?.id },
      { material_id: material.id, sales_organization_id: salesOrg.id, distribution_channel_id: channel['20'], price: wholesale, ...validity, created_by: admin?.id },
    ]);
  }

  // Preço especial de café para a padaria e descontos de exemplo.
  const cafe = await knex('materials').where({ code: 'ALM-0003' }).first('id');
  const arroz = await knex('materials').where({ code: 'ALM-0001' }).first('id');
  const padaria = await knex('customers').where({ code: 'C0003' }).first('id');
  const atacadao = await knex('customers').where({ code: 'C0002' }).first('id');
  if (cafe && padaria) {
    await knex('product_prices').insert({ material_id: cafe.id, sales_organization_id: salesOrg.id, customer_id: padaria.id, price: 23.9, ...validity, created_by: admin?.id });
  }
  await knex('price_discounts').insert([
    { sales_organization_id: salesOrg.id, distribution_channel_id: channel['20'], percent: 3, description: 'Desconto padrão do atacado', ...validity, created_by: admin?.id },
    ...(atacadao && arroz ? [{ sales_organization_id: salesOrg.id, customer_id: atacadao.id, material_id: arroz.id, percent: 8, description: 'Campanha de arroz para o Atacadão', ...validity, created_by: admin?.id }] : []),
  ]);
}
