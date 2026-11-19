// Catálogo de permissões e roles de sistema (Etapa 2).
// As permissões de MM e SD já existem aqui para as roles ficarem completas. As rotas que as
// exigem chegam nas Etapas 3 e 4.
//
// Roles de sistema (is_system = true) são sincronizadas com esta lista a cada seed: o que está
// aqui é a verdade. Para outras combinações, crie roles personalizadas (código Z_...) na tela.

export const PERMISSIONS = [
  // Administração
  ['ADMIN.ORG.READ', 'ADMIN', 'Consultar a estrutura organizacional'],
  ['ADMIN.ORG.CREATE', 'ADMIN', 'Criar itens da estrutura organizacional'],
  ['ADMIN.ORG.UPDATE', 'ADMIN', 'Alterar itens da estrutura organizacional'],
  ['ADMIN.ORG.DELETE', 'ADMIN', 'Excluir itens da estrutura organizacional'],
  ['ADMIN.SETTINGS.READ', 'ADMIN', 'Consultar parâmetros gerais'],
  ['ADMIN.SETTINGS.UPDATE', 'ADMIN', 'Alterar parâmetros gerais'],
  ['ADMIN.AUDIT.READ', 'ADMIN', 'Consultar a trilha de auditoria'],
  ['ADMIN.USER.READ', 'ADMIN', 'Consultar usuários'],
  ['ADMIN.USER.CREATE', 'ADMIN', 'Criar usuários'],
  ['ADMIN.USER.UPDATE', 'ADMIN', 'Alterar, bloquear e redefinir a senha de usuários'],
  ['ADMIN.ROLE.READ', 'ADMIN', 'Consultar roles e permissões'],
  ['ADMIN.ROLE.MAINTAIN', 'ADMIN', 'Criar e alterar roles personalizadas'],
  ['ADMIN.ROLE.ASSIGN', 'ADMIN', 'Atribuir roles e escopo organizacional a usuários'],
  // MM
  ['MM.MATERIAL.READ', 'MM', 'Consultar materiais'],
  ['MM.MATERIAL.CREATE', 'MM', 'Criar materiais'],
  ['MM.MATERIAL.UPDATE', 'MM', 'Alterar, bloquear e inativar materiais'],
  ['MM.SUPPLIER.READ', 'MM', 'Consultar fornecedores'],
  ['MM.SUPPLIER.CREATE', 'MM', 'Criar fornecedores'],
  ['MM.SUPPLIER.UPDATE', 'MM', 'Alterar, bloquear e inativar fornecedores'],
  ['MM.PURCHASE_REQ.READ', 'MM', 'Consultar requisições de compra'],
  ['MM.PURCHASE_REQ.CREATE', 'MM', 'Criar requisições de compra'],
  ['MM.PURCHASE_REQ.APPROVE', 'MM', 'Aprovar ou rejeitar requisições de compra'],
  ['MM.PURCHASE_ORDER.READ', 'MM', 'Consultar pedidos de compra'],
  ['MM.PURCHASE_ORDER.CREATE', 'MM', 'Criar e alterar pedidos de compra'],
  ['MM.PURCHASE_ORDER.APPROVE', 'MM', 'Aprovar, rejeitar ou cancelar pedidos de compra'],
  ['MM.GOODS_RECEIPT.POST', 'MM', 'Registrar recebimento de mercadorias'],
  ['MM.GOODS_RECEIPT.OVERDELIVERY', 'MM', 'Receber acima do pedido, até a tolerância do fornecedor'],
  ['MM.STOCK.READ', 'MM', 'Consultar estoque e movimentações'],
  ['MM.STOCK.ADJUST', 'MM', 'Ajustar estoque e lançar inventário (com justificativa)'],
  ['MM.MRP.RUN', 'MM', 'Executar o MRP simplificado e converter sugestões'],
  // SD
  ['SD.CUSTOMER.READ', 'SD', 'Consultar clientes'],
  ['SD.CUSTOMER.CREATE', 'SD', 'Criar clientes'],
  ['SD.CUSTOMER.UPDATE', 'SD', 'Alterar, bloquear e inativar clientes'],
  ['SD.PRICE.READ', 'SD', 'Consultar preços e condições'],
  ['SD.PRICE.UPDATE', 'SD', 'Manter preços, descontos e condições'],
  ['SD.SALES_ORDER.READ', 'SD', 'Consultar pedidos de venda'],
  ['SD.SALES_ORDER.CREATE', 'SD', 'Criar e alterar pedidos de venda'],
  ['SD.SALES_ORDER.APPROVE', 'SD', 'Aprovar, confirmar ou cancelar pedidos de venda'],
  ['SD.DELIVERY.CREATE', 'SD', 'Criar entregas e registrar a saída de mercadoria'],
  ['SD.BILLING.CREATE', 'SD', 'Criar documentos de faturamento'],
  ['SD.BILLING.CANCEL', 'SD', 'Estornar faturamento'],
  ['SD.PAYMENT.POST', 'SD', 'Registrar pagamento de títulos (simulado)'],
];

const ALL = PERMISSIONS.map((p) => p[0]);
const of = (prefix) => ALL.filter((p) => p.startsWith(prefix));
const reads = (prefix) => of(prefix).filter((p) => p.endsWith('.READ'));

export const ROLES = {
  SAP_ADMIN: {
    name: 'Administrador do ERP',
    description: 'Acesso total. Use só para administração do sistema.',
    permissions: ALL,
  },
  MM_MANAGER: {
    name: 'Gestor de Materiais',
    description: 'Tudo em MM, inclusive aprovações e ajuste de estoque.',
    permissions: [...of('MM.'), 'ADMIN.ORG.READ'],
  },
  MM_ANALYST: {
    name: 'Analista de Materiais',
    description: 'Mantém materiais e fornecedores, cria requisições e roda o MRP. Não aprova.',
    permissions: [
      ...reads('MM.'), 'MM.MATERIAL.CREATE', 'MM.MATERIAL.UPDATE', 'MM.SUPPLIER.CREATE', 'MM.SUPPLIER.UPDATE',
      'MM.PURCHASE_REQ.CREATE', 'MM.MRP.RUN', 'ADMIN.ORG.READ',
    ],
  },
  PROCUREMENT: {
    name: 'Comprador',
    description: 'Fornecedores, requisições e pedidos de compra. Não aprova.',
    permissions: [
      'MM.MATERIAL.READ', 'MM.SUPPLIER.READ', 'MM.SUPPLIER.CREATE', 'MM.SUPPLIER.UPDATE', 'MM.PURCHASE_REQ.READ',
      'MM.PURCHASE_REQ.CREATE', 'MM.PURCHASE_ORDER.READ', 'MM.PURCHASE_ORDER.CREATE', 'MM.STOCK.READ', 'ADMIN.ORG.READ',
    ],
  },
  WAREHOUSE: {
    name: 'Almoxarife / Expedição',
    description: 'Recebe mercadorias, consulta estoque e registra entregas.',
    permissions: [
      'MM.MATERIAL.READ', 'MM.PURCHASE_ORDER.READ', 'MM.GOODS_RECEIPT.POST', 'MM.STOCK.READ',
      'SD.SALES_ORDER.READ', 'SD.DELIVERY.CREATE', 'ADMIN.ORG.READ',
    ],
  },
  SD_MANAGER: {
    name: 'Gestor de Vendas',
    description: 'Tudo em SD, inclusive aprovações e estornos.',
    permissions: [...of('SD.'), 'MM.MATERIAL.READ', 'MM.STOCK.READ', 'ADMIN.ORG.READ'],
  },
  SD_ANALYST: {
    name: 'Analista de Vendas',
    description: 'Clientes, pedidos, entregas e faturamento. Não aprova nem estorna.',
    permissions: [
      ...reads('SD.'), 'SD.CUSTOMER.CREATE', 'SD.CUSTOMER.UPDATE', 'SD.SALES_ORDER.CREATE', 'SD.DELIVERY.CREATE',
      'SD.BILLING.CREATE', 'MM.MATERIAL.READ', 'MM.STOCK.READ', 'ADMIN.ORG.READ',
    ],
  },
  SALES: {
    name: 'Vendedor',
    description: 'Consulta clientes, preços e estoque e cria pedidos de venda.',
    permissions: [
      'SD.CUSTOMER.READ', 'SD.CUSTOMER.CREATE', 'SD.PRICE.READ', 'SD.SALES_ORDER.READ', 'SD.SALES_ORDER.CREATE',
      'MM.MATERIAL.READ', 'MM.STOCK.READ', 'ADMIN.ORG.READ',
    ],
  },
  AUDITOR: {
    name: 'Auditor',
    description: 'Somente leitura de tudo, inclusive a trilha de auditoria.',
    permissions: ALL.filter((p) => p.endsWith('.READ')),
  },
};

export async function seed(knex) {
  await knex('permissions')
    .insert(PERMISSIONS.map(([code, module, description]) => ({ code, module, description })))
    .onConflict('code')
    .merge(['module', 'description']);

  await knex('roles')
    .insert(Object.entries(ROLES).map(([code, r]) => ({ code, name: r.name, description: r.description, is_system: true })))
    .onConflict('code')
    .merge(['name', 'description', 'is_system']);

  const permId = Object.fromEntries((await knex('permissions').select('id', 'code')).map((p) => [p.code, p.id]));
  const roleId = Object.fromEntries((await knex('roles').select('id', 'code')).map((r) => [r.code, r.id]));

  // Sincroniza exatamente as permissões das roles de sistema.
  for (const [code, r] of Object.entries(ROLES)) {
    await knex('role_permissions').where({ role_id: roleId[code] }).del();
    await knex('role_permissions').insert(r.permissions.map((p) => ({ role_id: roleId[code], permission_id: permId[p] })));
  }
}
