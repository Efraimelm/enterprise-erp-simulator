// Mapa de navegação do ERP. "stage" diz em qual etapa do roadmap a tela fica pronta;
// itens com path são os já implementados. A tela mostra os demais como "planejado".
export const navigation = [
  {
    group: 'Visão geral',
    items: [{ label: 'Painel', path: '/', icon: '◧' }],
  },
  {
    group: 'Administração',
    items: [
      { label: 'Estrutura organizacional', path: '/admin/estrutura', icon: '▦', permission: 'ADMIN.ORG.READ' },
      { label: 'Parâmetros gerais', path: '/admin/parametros', icon: '⚙', permission: 'ADMIN.SETTINGS.READ' },
      { label: 'Usuários', path: '/admin/usuarios', permission: 'ADMIN.USER.READ' },
      { label: 'Roles e permissões', path: '/admin/roles', permission: 'ADMIN.ROLE.READ' },
      { label: 'Auditoria', path: '/admin/auditoria', icon: '⎙', permission: 'ADMIN.AUDIT.READ' },
    ],
  },
  {
    group: 'MM · Materiais',
    items: [
      { label: 'Materiais', path: '/mm/materiais', permission: 'MM.MATERIAL.READ' },
      { label: 'Fornecedores', path: '/mm/fornecedores', permission: 'MM.SUPPLIER.READ' },
      { label: 'Estoque', path: '/mm/estoque', permission: 'MM.STOCK.READ' },
      { label: 'Requisições de compra', path: '/mm/requisicoes', permission: 'MM.PURCHASE_REQ.READ' },
      { label: 'Pedidos de compra', path: '/mm/pedidos', permission: 'MM.PURCHASE_ORDER.READ' },
      { label: 'Recebimentos', path: '/mm/recebimentos', permission: 'MM.PURCHASE_ORDER.READ', anyOf: ['MM.STOCK.READ', 'MM.PURCHASE_ORDER.READ'] },
      { label: 'MRP simplificado', path: '/mm/mrp', permission: 'MM.MRP.RUN' },
    ],
  },
  {
    group: 'SD · Vendas',
    items: [
      { label: 'Clientes', stage: 4 },
      { label: 'Condições comerciais', stage: 4 },
      { label: 'Pedidos de venda', stage: 4 },
      { label: 'Entregas', stage: 4 },
      { label: 'Faturamento', stage: 4 },
      { label: 'Contas a receber (simulado)', stage: 4 },
    ],
  },
  {
    group: 'Integração e análise',
    items: [
      { label: 'Integrações (API, n8n)', stage: 6 },
      { label: 'Assistente de IA', stage: 6 },
      { label: 'Relatórios e BI', stage: 7 },
    ],
  },
];

export const roadmap = [
  { stage: 1, title: 'Fundação', detail: 'Banco, backend, frontend, login, layout e estrutura organizacional', status: 'done' },
  { stage: 2, title: 'Segurança', detail: 'Usuários, roles, permissões, escopo por centro e testes de acesso', status: 'done' },
  { stage: 3, title: 'MM', detail: 'Materiais, fornecedores, estoque, requisição, pedido, recebimento e MRP', status: 'done' },
  { stage: 4, title: 'SD', detail: 'Clientes, preços, pedido de venda, ATP, entrega, faturamento e recebimento', status: 'next' },
  { stage: 5, title: 'Integração MM + SD', detail: 'Estoque compartilhado, reservas, saídas e trilha de documentos', status: 'planned' },
  { stage: 6, title: 'n8n e IA', detail: 'API documentada, webhooks, alertas e assistente com fonte', status: 'planned' },
  { stage: 7, title: 'BI', detail: 'Indicadores, relatórios e Power BI', status: 'planned' },
  { stage: 8, title: 'Portfólio', detail: 'Testes finais, documentação, vídeos e apresentação', status: 'planned' },
];
