// Documentação OpenAPI 3.1 da API de integração (leitura) e dos webhooks.
//   GET /api/openapi.json   especificação
//   GET /api/docs           Swagger UI
// A API é própria do Enterprise ERP Simulator: não é API SAP nem OData do SAP Gateway.
import { Router } from 'express';
import { EVENT_TYPES } from '../../lib/events.js';

const page = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];
const q = (name, description, type = 'string', extra = {}) => ({ name, in: 'query', description, schema: { type, ...extra } });
const idPath = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const list = (summary, permission, params = [], tag) => ({
  get: {
    tags: [tag], summary, description: `Permissão: \`${permission}\`. Resultado limitado ao escopo (centros) do cliente.`,
    parameters: [...page, ...params],
    responses: { 200: { description: 'Lista paginada', content: { 'application/json': { schema: { $ref: '#/components/schemas/Page' } } } }, 401: { $ref: '#/components/responses/Unauthorized' }, 403: { $ref: '#/components/responses/Forbidden' } },
  },
});
const detail = (summary, permission, tag) => ({
  get: {
    tags: [tag], summary, description: `Permissão: \`${permission}\`. Fora do escopo → 403 \`OUT_OF_SCOPE\`.`, parameters: [idPath],
    responses: { 200: { description: 'Documento', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'object' } } } } } }, 403: { $ref: '#/components/responses/Forbidden' }, 404: { $ref: '#/components/responses/NotFound' } },
  },
});

export function buildOpenApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Enterprise ERP Simulator — API de integração',
      version: '1.0.0',
      description: [
        'API REST **própria** do Enterprise ERP Simulator (projeto educacional). **Não é** API SAP, **não é** OData do SAP Gateway e não tem certificação SAP.',
        '',
        '**Autenticação:** `Authorization: Bearer erp_<prefixo>_<segredo>` (chave criada em Administração → Integrações). Nesta versão as chaves são **somente leitura** (escrita → 403 `READ_ONLY_KEY`).',
        '**Permissões e escopo:** a chave pertence a um cliente de integração (usuário técnico) com roles e centros definidos; a API mostra só o que ele pode ver.',
        '**Erros:** `{ "error": { "code", "message", "details": [{ "field", "message" }] } }`.',
        '**Limite:** 300 chamadas por minuto por chave (429).',
        '**Idempotência:** para POST com sessão de usuário, envie `Idempotency-Key`; a repetição devolve a resposta original (`Idempotent-Replay: true`).',
      ].join('\n'),
    },
    servers: [{ url: '/api', description: 'Este servidor' }],
    security: [{ apiKey: [] }],
    tags: [
      { name: 'Indicadores' }, { name: 'MM' }, { name: 'SD' }, { name: 'Trilha' },
    ],
    paths: {
      '/kpis/summary': {
        get: {
          tags: ['Indicadores'], summary: 'Indicadores consolidados (estoque, compras, vendas, financeiro) com as fórmulas',
          description: 'Permissão: `BI.KPI.READ`. Usado pelo resumo diário do n8n e pelo Power BI.',
          parameters: [q('plant_id', 'Filtra um centro do escopo', 'integer')],
          responses: { 200: { description: 'Indicadores', content: { 'application/json': { schema: { $ref: '#/components/schemas/KpiSummary' } } } } },
        },
      },
      '/reports': { get: { tags: ['Indicadores'], summary: 'Relatórios de BI disponíveis para a chave (com definição e colunas)', responses: { 200: { description: 'Lista' } } } },
      '/reports/{name}': {
        get: {
          tags: ['Indicadores'], summary: 'Relatório de BI (posição e giro de estoque, compras por fornecedor, pendências, vendas por período, aging)',
          description: 'Use all=true no Power BI (até 20.000 linhas) ou format=csv (UTF-8 com BOM, separador ;). A resposta traz meta.definition com a fórmula.',
          parameters: [
            { name: 'name', in: 'path', required: true, schema: { type: 'string', enum: ['stock-position', 'stock-turnover', 'purchases-by-supplier', 'open-purchase-orders', 'sales-by-period', 'open-sales-orders', 'receivables-aging'] } },
            q('from', 'Início (AAAA-MM-DD; padrão: 90 dias atrás)'), q('to', 'Fim (AAAA-MM-DD; padrão: hoje)'), q('plant_id', 'Centro', 'integer'),
            q('group', 'day | month (vendas por período)'), q('all', 'true = todas as linhas'), q('format', 'json | csv'), q('decimal', 'comma | dot (CSV)'),
          ],
          responses: { 200: { description: 'Linhas, totais, colunas e meta (com a fórmula)' }, 403: { $ref: '#/components/responses/Forbidden' } },
        },
      },
      '/mm/materials': list('Materiais', 'MM.MATERIAL.READ', [q('q', 'Código, descrição ou categoria'), q('status', 'ACTIVE | BLOCKED | INACTIVE'), q('plant_id', 'Materiais estendidos para o centro', 'integer')], 'MM'),
      '/mm/materials/{id}': detail('Material com dados por centro, estoque, fornecedores e histórico', 'MM.MATERIAL.READ', 'MM'),
      '/mm/stock': list('Saldos de estoque (físico, reservado, disponível)', 'MM.STOCK.READ', [q('plant_id', 'Centro', 'integer'), q('material_id', 'Material', 'integer'), q('below_reorder', 'true = só abaixo do ponto de reposição')], 'MM'),
      '/mm/stock/movements': list('Movimentos de estoque (documentos de material)', 'MM.STOCK.READ', [q('movement_type', '101, 201, 311, 561, 601, 701, 702'), q('doc_number', 'Documento de material')], 'MM'),
      '/mm/suppliers': list('Fornecedores', 'MM.SUPPLIER.READ', [q('q', 'Código, nome ou cidade')], 'MM'),
      '/mm/purchase-requisitions': list('Requisições de compra', 'MM.PURCHASE_REQ.READ', [q('status', 'PENDING_APPROVAL | APPROVED | …'), q('source', 'MANUAL | MRP')], 'MM'),
      '/mm/purchase-orders': list('Pedidos de compra', 'MM.PURCHASE_ORDER.READ', [q('status', 'DRAFT | PENDING_APPROVAL | APPROVED | SENT | PARTIALLY_RECEIVED | RECEIVED | CANCELLED'), q('supplier_id', 'Fornecedor', 'integer')], 'MM'),
      '/mm/purchase-orders/{id}': detail('Pedido de compra com itens, recebimentos e requisições de origem', 'MM.PURCHASE_ORDER.READ', 'MM'),
      '/sd/customers': list('Clientes', 'SD.CUSTOMER.READ', [q('q', 'Código, nome ou cidade')], 'SD'),
      '/sd/sales-orders': list('Pedidos de venda', 'SD.SALES_ORDER.READ', [q('status', 'CONFIRMED | IN_DELIVERY | …'), q('deliverable', 'true = confirmados ainda não totalmente entregues')], 'SD'),
      '/sd/sales-orders/{id}': detail('Pedido de venda com itens (confirmado, entregue, faturado) e fluxo de documentos', 'SD.SALES_ORDER.READ', 'SD'),
      '/sd/deliveries': list('Entregas', 'SD.SALES_ORDER.READ', [q('status', 'CREATED | PICKED | POSTED'), q('unbilled', 'true = lançadas e não faturadas')], 'SD'),
      '/sd/billing': list('Faturas e estornos', 'SD.BILLING.READ', [q('type', 'INVOICE | CANCELLATION')], 'SD'),
      '/sd/receivables': list('Títulos a receber (simulado)', 'SD.RECEIVABLE.READ', [q('open', 'true = em aberto'), q('overdue', 'true = atrasados')], 'SD'),
      '/flow/search': {
        get: { tags: ['Trilha'], summary: 'Busca documento pelo número', parameters: [{ ...q('q', 'Número (só dígitos)'), required: true }], responses: { 200: { description: 'Documentos encontrados' } } },
      },
      '/flow/{type}/{id}': {
        get: {
          tags: ['Trilha'], summary: 'Trilha de documentos de ponta a ponta (ligação compra → venda por FIFO simulado)',
          parameters: [
            { name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['PURCHASE_REQ', 'PURCHASE_ORDER', 'MATERIAL_DOC', 'SALES_ORDER', 'DELIVERY', 'BILLING', 'RECEIVABLE', 'PAYMENT'] } },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Grafo { root, nodes, edges, hidden, truncated }' } },
        },
      },
    },
    webhooks: Object.fromEntries(Object.entries(EVENT_TYPES).map(([type, description]) => [type, {
      post: {
        summary: description,
        description: 'Enviado às assinaturas que escolheram este evento. Confira `X-ERP-Signature = sha256=HMAC_SHA256(segredo, X-ERP-Timestamp + "." + corpo)` e rejeite timestamps com mais de 5 minutos. Use `X-ERP-Event-Id` para ignorar duplicatas. Responda 2xx; caso contrário o ERP tenta de novo em 1 min, 5 min, 30 min, 2 h e 6 h.',
        parameters: ['X-ERP-Event', 'X-ERP-Event-Id', 'X-ERP-Delivery', 'X-ERP-Timestamp', 'X-ERP-Signature'].map((h) => ({ name: h, in: 'header', required: true, schema: { type: 'string' } })),
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEnvelope' } } } },
        responses: { 200: { description: 'Recebido' } },
      },
    }])),
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'erp_<prefixo>_<segredo>' } },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'object' } } } } } },
        Page: { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' } } },
        KpiSummary: { type: 'object', properties: { data: { type: 'object', properties: { estoque: { type: 'object' }, compras: { type: 'object' }, vendas: { type: 'object' }, financeiro: { type: 'object' }, definitions: { type: 'object' } } } } },
        WebhookEnvelope: {
          type: 'object', required: ['id', 'type', 'occurred_at', 'source', 'data'],
          properties: { id: { type: 'string', format: 'uuid' }, type: { type: 'string', enum: Object.keys(EVENT_TYPES) }, occurred_at: { type: 'string', format: 'date-time' }, source: { type: 'string', const: 'enterprise-erp-simulator' }, data: { type: 'object' } },
        },
      },
      responses: {
        Unauthorized: { description: 'Sem chave, chave inválida, revogada ou expirada', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        Forbidden: { description: 'Sem permissão, fora do escopo ou escrita com chave somente leitura', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        NotFound: { description: 'Não encontrado', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  };
}

const SWAGGER_VERSION = '5.17.14';
const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>API de integração — Enterprise ERP Simulator</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css">
<style>body{margin:0} .topbar{display:none}</style></head>
<body><div id="swagger"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js"></script>
<script src="./docs-init.js"></script></body></html>`;
const init = "window.ui = SwaggerUIBundle({ url: './openapi.json', dom_id: '#swagger', persistAuthorization: false });";

export const openApiRouter = Router();
openApiRouter.get('/openapi.json', (req, res) => res.json(buildOpenApi()));
openApiRouter.get('/docs-init.js', (req, res) => res.type('application/javascript').send(init));
openApiRouter.get('/docs', (req, res) => {
  // CSP própria desta página: permite o Swagger UI da CDN (jsDelivr), nada mais.
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self'");
  res.type('html').send(html);
});
