// Etapa 3 - Numeração, configuração de compras e dados de demonstração do MM.
// Idempotente: só insere o que falta. O estoque inicial é lançado pelo serviço de estoque
// (movimento 561, com documento e responsável), nunca escrito direto no saldo.
import { postMaterialDocument } from '../../backend/src/modules/mm/stock-service.js';

const SEQUENCES = [
  { doc_type: 'PURCHASE_REQ', description: 'Requisição de compra', prefix: '10', length: 10 },
  { doc_type: 'PURCHASE_ORDER', description: 'Pedido de compra', prefix: '45', length: 10 },
  { doc_type: 'MATERIAL_DOC', description: 'Documento de material (movimento de estoque)', prefix: '49', length: 10 },
  { doc_type: 'INVENTORY_DOC', description: 'Documento de inventário', prefix: '01', length: 10 },
];

const TAX_CODES = [
  { code: 'I0', name: 'Isento (simulado)', rate: 0 },
  { code: 'I1', name: 'ICMS 12% (simulado)', rate: 12 },
  { code: 'I2', name: 'ICMS 18% (simulado)', rate: 18 },
];

const PAYMENT_TERMS = [
  { code: 'AV', name: 'À vista', days: 0 },
  { code: 'D30', name: '30 dias', days: 30 },
  { code: 'D60', name: '60 dias', days: 60 },
];

// [código, descrição, tipo, categoria, unidade, preço ref., ponto de reposição, mínimo, máximo, estoque CF10, estoque CF20]
const MATERIALS = [
  ['ALM-0001', 'Arroz tipo 1 5 kg', 'HAWA', 'Alimentos', 'UN', 24.9, 50, 20, 200, 120, 40],
  ['ALM-0002', 'Feijão carioca 1 kg', 'HAWA', 'Alimentos', 'UN', 8.5, 80, 30, 300, 35, 90],
  ['ALM-0003', 'Café torrado 500 g', 'HAWA', 'Alimentos', 'UN', 18.9, 40, 15, 150, 60, 10],
  ['BEB-0001', 'Refrigerante cola 2 L', 'HAWA', 'Bebidas', 'UN', 9.9, 100, 40, 400, 250, 300],
  ['BEB-0002', 'Água mineral 500 ml', 'HAWA', 'Bebidas', 'UN', 2.2, 200, 80, 800, 150, 500],
  ['CON-0001', 'Sacola plástica (pacote com 100)', 'HIBE', 'Consumo interno', 'PCT', 15, 10, 5, 40, 12, 3],
];

const SUPPLIERS = [
  {
    code: 'F0001', name: 'Distribuidora Grãos do Sul', legal_name: 'Grãos do Sul Distribuidora Ltda (fictícia)', tax_id: '00.000.001/0001-01',
    city: 'Curitiba', state: 'PR', contact_name: 'Ana Souza', email: 'vendas@graosdosul.exemplo', term: 'D30', tolerance: 5,
    prices: { 'ALM-0001': 21.5, 'ALM-0002': 7.4, 'ALM-0003': 16.8 }, lead: 5,
  },
  {
    code: 'F0002', name: 'Bebidas Brasil Atacado', legal_name: 'Bebidas Brasil Atacado S.A. (fictícia)', tax_id: '00.000.002/0001-02',
    city: 'Jundiaí', state: 'SP', contact_name: 'Carlos Lima', email: 'pedidos@bebidasbrasil.exemplo', term: 'D30', tolerance: 2,
    prices: { 'BEB-0001': 8.3, 'BEB-0002': 1.6 }, lead: 3,
  },
  {
    code: 'F0003', name: 'Embalagens Paulista', legal_name: 'Embalagens Paulista Ltda (fictícia)', tax_id: '00.000.003/0001-03',
    city: 'São Paulo', state: 'SP', contact_name: 'Beatriz Rocha', email: 'contato@embpaulista.exemplo', term: 'AV', tolerance: 0,
    prices: { 'CON-0001': 13.9 }, lead: 2,
  },
];

export async function seed(knex) {
  await knex('document_sequences').insert(SEQUENCES).onConflict('doc_type').ignore();
  await knex('tax_codes').insert(TAX_CODES).onConflict('code').ignore();
  await knex('payment_terms').insert(PAYMENT_TERMS).onConflict('code').ignore();

  const admin = await knex('users').where({ username: 'admin' }).first('id');
  const plants = Object.fromEntries((await knex('plants').whereIn('code', ['CF10', 'CF20']).select('id', 'code')).map((p) => [p.code, p.id]));
  const sloc = async (plantCode, code) => (await knex('storage_locations').where({ plant_id: plants[plantCode], code }).first('id'))?.id;
  const groups = Object.fromEntries((await knex('purchasing_groups').select('id', 'code')).map((g) => [g.code, g.id]));
  if (!plants.CF10 || !plants.CF20) return; // estrutura de demonstração ausente

  const alreadySeeded = await knex('materials').first('id');

  for (const [code, description, type, category, unit, price, rop, min, max] of MATERIALS) {
    await knex('materials')
      .insert({ code, description, material_type: type, category, base_unit: unit, reference_price: price, created_by: admin?.id, updated_by: admin?.id })
      .onConflict('code').ignore();
    const material = await knex('materials').where({ code }).first('id');
    for (const plant of ['CF10', 'CF20']) {
      await knex('material_plant_data')
        .insert({
          material_id: material.id, plant_id: plants[plant], default_storage_location_id: await sloc(plant, '0001'),
          purchasing_group_id: groups[category === 'Bebidas' ? '002' : '001'] ?? null,
          reorder_point: rop, min_stock: min, max_stock: max,
        })
        .onConflict(['material_id', 'plant_id']).ignore();
    }
  }

  for (const s of SUPPLIERS) {
    const term = await knex('payment_terms').where({ code: s.term }).first('id');
    await knex('suppliers')
      .insert({
        code: s.code, name: s.name, legal_name: s.legal_name, tax_id: s.tax_id, city: s.city, state: s.state,
        contact_name: s.contact_name, email: s.email, payment_term_id: term.id, overdelivery_tolerance_pct: s.tolerance,
        created_by: admin?.id, updated_by: admin?.id,
      })
      .onConflict('code').ignore();
    const supplier = await knex('suppliers').where({ code: s.code }).first('id');
    for (const [materialCode, netPrice] of Object.entries(s.prices)) {
      const material = await knex('materials').where({ code: materialCode }).first('id');
      await knex('supplier_materials')
        .insert({ supplier_id: supplier.id, material_id: material.id, net_price: netPrice, lead_time_days: s.lead })
        .onConflict(['supplier_id', 'material_id']).ignore();
    }
  }

  // Estoque inicial: só na primeira carga, por documento de material 561.
  if (!alreadySeeded && admin) {
    await knex.transaction(async (trx) => {
      const lines = [];
      for (const [code, , , , , , , , , cf10, cf20] of MATERIALS) {
        const material = await trx('materials').where({ code }).first('id');
        lines.push({ movementType: 561, materialId: material.id, plantId: plants.CF10, storageLocationId: await sloc('CF10', '0001'), quantity: cf10 });
        lines.push({ movementType: 561, materialId: material.id, plantId: plants.CF20, storageLocationId: await sloc('CF20', '0001'), quantity: cf20 });
      }
      await postMaterialDocument(trx, { lines, reason: 'Carga inicial de estoque (dados de demonstração)', userId: admin.id });
    });
  }
}
