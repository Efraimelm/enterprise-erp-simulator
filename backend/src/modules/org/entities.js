// Definição única das entidades da estrutura organizacional.
// Daqui saem: a validação do backend, as rotas REST e os formulários da tela (via GET /api/org/meta).
// Assim, backend e frontend nunca ficam com regras diferentes.
//
// Tipos de campo:
//   code      código em maiúsculas (letras e números), com tamanho máximo
//   text      texto livre
//   email     e-mail
//   country   ISO 3166 (2 letras, ex.: BR)
//   currency  ISO 4217 (3 letras, ex.: BRL)
//   language  ex.: pt-BR
//   timezone  IANA (ex.: America/Sao_Paulo)
//   uf        sigla de estado brasileiro (2 letras)
//   ref       chave estrangeira para outra entidade (ref = chave da entidade)
//   boolean   sim/não

const code = (maxLength) => ({ name: 'code', label: 'Código', type: 'code', maxLength, required: true });
const name = { name: 'name', label: 'Nome', type: 'text', maxLength: 80, required: true };

export const entities = [
  {
    key: 'companies',
    table: 'companies',
    label: 'Empresas',
    singular: 'Empresa',
    sapConcept: 'Empresa (company code): unidade legal com balanço próprio.',
    fields: [
      code(4),
      name,
      { name: 'legal_name', label: 'Razão social (fictícia)', type: 'text', maxLength: 120, required: true },
      { name: 'tax_id', label: 'CNPJ (fictício)', type: 'text', maxLength: 20 },
      { name: 'city', label: 'Cidade', type: 'text', maxLength: 60 },
      { name: 'country', label: 'País', type: 'country', required: true },
      { name: 'currency', label: 'Moeda', type: 'currency', required: true },
      { name: 'language', label: 'Idioma', type: 'language', required: true },
      { name: 'timezone', label: 'Fuso horário', type: 'timezone', required: true },
    ],
  },
  {
    key: 'plants',
    table: 'plants',
    label: 'Centros',
    singular: 'Centro',
    sapConcept: 'Centro (plant): fábrica, loja ou centro de distribuição onde o estoque existe.',
    fields: [
      code(4),
      name,
      { name: 'company_id', label: 'Empresa', type: 'ref', ref: 'companies', required: true },
      { name: 'city', label: 'Cidade', type: 'text', maxLength: 60 },
      { name: 'state', label: 'UF', type: 'uf' },
    ],
  },
  {
    key: 'storage-locations',
    table: 'storage_locations',
    label: 'Depósitos',
    singular: 'Depósito',
    sapConcept: 'Depósito (storage location): subdivisão física do centro. O código se repete entre centros.',
    fields: [
      { name: 'plant_id', label: 'Centro', type: 'ref', ref: 'plants', required: true },
      code(4),
      name,
    ],
  },
  {
    key: 'sales-organizations',
    table: 'sales_organizations',
    label: 'Organizações de vendas',
    singular: 'Organização de vendas',
    sapConcept: 'Organização de vendas: responsável pela venda e pelas condições comerciais.',
    fields: [
      code(4),
      name,
      { name: 'company_id', label: 'Empresa', type: 'ref', ref: 'companies', required: true },
      { name: 'currency', label: 'Moeda', type: 'currency', required: true },
    ],
  },
  {
    key: 'distribution-channels',
    table: 'distribution_channels',
    label: 'Canais de distribuição',
    singular: 'Canal de distribuição',
    sapConcept: 'Canal de distribuição: como o produto chega ao cliente (varejo, atacado, e-commerce).',
    fields: [code(2), name],
  },
  {
    key: 'divisions',
    table: 'divisions',
    label: 'Setores de atividade',
    singular: 'Setor de atividade',
    sapConcept: 'Setor de atividade (division): linha de produtos.',
    fields: [code(2), name],
  },
  {
    key: 'sales-areas',
    table: 'sales_areas',
    label: 'Áreas de vendas',
    singular: 'Área de vendas',
    sapConcept: 'Área de vendas: combinação organização de vendas + canal + setor em que se pode vender.',
    fields: [
      { name: 'sales_organization_id', label: 'Organização de vendas', type: 'ref', ref: 'sales-organizations', required: true },
      { name: 'distribution_channel_id', label: 'Canal de distribuição', type: 'ref', ref: 'distribution-channels', required: true },
      { name: 'division_id', label: 'Setor de atividade', type: 'ref', ref: 'divisions', required: true },
    ],
  },
  {
    key: 'purchasing-organizations',
    table: 'purchasing_organizations',
    label: 'Organizações de compras',
    singular: 'Organização de compras',
    sapConcept: 'Organização de compras: negocia com fornecedores e é responsável pelas compras.',
    fields: [code(4), name, { name: 'company_id', label: 'Empresa', type: 'ref', ref: 'companies', required: true }],
  },
  {
    key: 'purchasing-org-plants',
    table: 'purchasing_org_plants',
    label: 'Org. de compras × centros',
    singular: 'Atribuição de centro',
    sapConcept: 'Atribuição: para quais centros a organização de compras pode comprar.',
    fields: [
      { name: 'purchasing_organization_id', label: 'Organização de compras', type: 'ref', ref: 'purchasing-organizations', required: true },
      { name: 'plant_id', label: 'Centro', type: 'ref', ref: 'plants', required: true },
    ],
  },
  {
    key: 'purchasing-groups',
    table: 'purchasing_groups',
    label: 'Grupos de compradores',
    singular: 'Grupo de compradores',
    sapConcept: 'Grupo de compradores: comprador ou equipe responsável por um conjunto de materiais.',
    fields: [code(3), name, { name: 'email', label: 'E-mail (fictício)', type: 'email', maxLength: 160 }],
  },
];

// Campo comum a todas: ativo/inativo (inativar em vez de excluir quando já houver uso).
for (const e of entities) {
  e.fields.push({ name: 'is_active', label: 'Ativo', type: 'boolean', default: true });
}

export const entityByKey = Object.fromEntries(entities.map((e) => [e.key, e]));
