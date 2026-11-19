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
      { label: 'Auditoria', path: '/admin/auditoria', icon: '⎙', permission: 'ADMIN.AUDIT.READ' },
      { label: 'Usuários e roles', stage: 2, icon: '☺' },
    ],
  },
  {
    group: 'MM · Materiais',
    items: [
      { label: 'Materiais', stage: 3 },
      { label: 'Fornecedores', stage: 3 },
      { label: 'Estoque', stage: 3 },
      { label: 'Requisições de compra', stage: 3 },
      { label: 'Pedidos de compra', stage: 3 },
      { label: 'Recebimentos', stage: 3 },
      { label: 'MRP simplificado', stage: 3 },
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
  { stage: 2, title: 'Segurança', detail: 'Usuários, roles, permissões, escopo por centro e testes de acesso', status: 'next' },
  { stage: 3, title: 'MM', detail: 'Materiais, fornecedores, estoque, requisição, pedido, recebimento e MRP', status: 'planned' },
  { stage: 4, title: 'SD', detail: 'Clientes, preços, pedido de venda, ATP, entrega, faturamento e recebimento', status: 'planned' },
  { stage: 5, title: 'Integração MM + SD', detail: 'Estoque compartilhado, reservas, saídas e trilha de documentos', status: 'planned' },
  { stage: 6, title: 'n8n e IA', detail: 'API documentada, webhooks, alertas e assistente com fonte', status: 'planned' },
  { stage: 7, title: 'BI', detail: 'Indicadores, relatórios e Power BI', status: 'planned' },
  { stage: 8, title: 'Portfólio', detail: 'Testes finais, documentação, vídeos e apresentação', status: 'planned' },
];
