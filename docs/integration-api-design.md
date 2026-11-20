# Etapa 6: API de integração, webhooks, n8n e assistente de IA

> A API é **própria do Enterprise ERP Simulator**. Não é uma API SAP, não é OData do SAP Gateway e não tem certificação SAP.

## 1. Visão geral

```
                 ┌──────────────── ERP ────────────────┐
  n8n  ──GET───► │ API REST (/api/…)  ← chave de API    │   leitura, com as permissões e o escopo do cliente
                 │ /api/kpis/summary  /api/flow  …      │
  n8n  ◄─POST─── │ webhooks (outbox + HMAC + retry)     │ ◄─ eventos gravados na MESMA transação do documento
                 │ /api/docs  (OpenAPI 3 / Swagger)     │
  usuário ─────► │ /api/assistant/chat  (sessão dele)   │ ─► ferramentas só de leitura ─► Gemini (opcional)
                 └──────────────────────────────────────┘
```

## 2. Clientes de integração e chaves de API
- Um **cliente de integração** é um **usuário técnico**: não tem senha e não entra pela tela de login. Ele recebe roles e escopo como qualquer usuário.
- **Vantagem:** a API reaproveita `requirePermission` e o escopo por centro. O n8n vê exatamente o que a role e o escopo do cliente permitem.
- **Chave:** `erp_<prefixo>_<segredo>`, enviada em `Authorization: Bearer …`.
  - O banco guarda só o **hash SHA-256** e o prefixo, para identificar a chave.
  - A chave é **mostrada uma única vez**, ao ser criada.
  - Pode ser revogada e pode ter validade.
- **Só leitura nesta etapa:** chamadas por chave aceitam apenas `GET`. Qualquer escrita responde 403 `READ_ONLY_KEY`. A leitura por chave dispensa o cabeçalho CSRF, porque não usa cookie.
- **Limite de chamadas:** 300 por minuto por chave (429).
- Toda chamada por chave é registrada em `integration_logs`: cliente, método, rota, status e tempo. O corpo não é registrado.

## 3. Idempotência
O cabeçalho opcional `Idempotency-Key` funciona em qualquer `POST` autenticado. Quando a mesma chave é repetida pelo mesmo usuário na mesma rota, o ERP:
- **devolve a resposta original** e não executa de novo (`Idempotent-Replay: true`);
- responde 409 `IDEMPOTENCY_CONFLICT` se a chave vier com outro corpo;
- responde 409 `IDEMPOTENCY_IN_PROGRESS` se a primeira chamada ainda estiver em andamento.

Isso protege recebimento, saída, faturamento e pagamento contra clique duplo e contra novas tentativas do n8n. As chaves valem 24 h.

## 4. Eventos e webhooks
- **Outbox:** o evento é gravado em `integration_events` **na mesma transação** do documento. Se a operação falha, não há evento, e todo documento confirmado gera o seu evento.
- **Entrega:** um despachante (a cada 5 s) envia `POST` em JSON para cada assinatura ativa interessada no tipo do evento.
  - Cabeçalhos: `X-ERP-Event`, `X-ERP-Event-Id`, `X-ERP-Delivery`, `X-ERP-Timestamp` e `X-ERP-Signature: sha256=HMAC(segredo, timestamp + "." + corpo)`.
  - O receptor confere a assinatura e o horário, para evitar replay acima de 5 minutos.
  - O `X-ERP-Event-Id` permite ao receptor ignorar duplicatas.
- **Novas tentativas:** resposta 2xx encerra a entrega. Erro ou tempo esgotado (10 s) → nova tentativa em 1 min, 5 min, 30 min, 2 h e 6 h. Depois disso, a entrega fica `DEAD`, e dá para reenviar pela tela.
- O segredo da assinatura é guardado **cifrado** (AES-256-GCM, com a chave `WEBHOOK_SECRET_KEY` do `.env`).

| Evento | Quando | Dados principais |
| --- | --- | --- |
| `stock.below_reorder_point` | Saída, reserva ou ajuste que deixa o disponível do centro ≤ ponto de reposição (no máximo um aviso a cada 12 h por material × centro) | material, centro, disponível, ponto, máximo |
| `purchase_requisition.created` | RC criada (manual ou MRP) | número, centro, origem, itens, valor estimado |
| `purchase_order.approved` | PC aprovado (automático ou manual) | número, fornecedor, centro, total, aprovação automática |
| `goods_receipt.posted` | Recebimento lançado | documento, pedido, status do pedido, linhas |
| `sales_order.created` | Pedido de venda criado | número, cliente, centro, total |
| `sales_order.confirmed` | Pedido confirmado (com reserva) | número, confirmado × pedido por item |
| `delivery.posted` | Saída de mercadoria lançada | entrega, pedido, documento de material |
| `billing.created` | Fatura emitida | número, cliente, total, vencimento |

Envelope enviado: `{ "id", "type", "occurred_at", "source": "enterprise-erp-simulator", "data": { … } }`.

## 5. Assistente de IA (A9: respeita quem pergunta)
- O chat roda **dentro do ERP**, com a **sessão do próprio usuário**. Cada ferramenta chama as mesmas regras de permissão e escopo da API.
- Por isso, um vendedor não recebe pela IA dados de compras nem de outro centro.
- **Ferramentas só de leitura:** a IA **não** aprova, não altera estoque e não confirma vendas. Não existe ferramenta de escrita.
- **Cálculo determinista:** totais e custos são calculados no backend. O modelo só redige a resposta.
- **Fonte sempre:** a lista de fontes (ferramenta, rota e documentos) é montada **pelo backend**, a partir das ferramentas usadas, e não pelo modelo. Assim a citação não pode ser inventada.
- **Modelo:** Gemini (`GEMINI_MODEL`, padrão `gemini-3.1-flash-lite`), com a chave `GEMINI_API_KEY` só no `.env`.
- **Sem chave:** o assistente funciona em **modo determinista**. Ele reconhece as perguntas previstas na especificação e responde com os mesmos dados e fontes, sem redação por IA.
- Cada consulta vai para `ai_queries` com usuário, pergunta, ferramentas usadas, documentos citados e modo. Não guarda a chave nem dados pessoais além da pergunta.
- Na resposta, **fatos, estimativas e recomendações aparecem separados**. Quando faltam dados, o assistente diz isso.

| Ferramenta | Pergunta típica | Permissão exigida |
| --- | --- | --- |
| `materiais_abaixo_do_ponto` | Quais materiais estão abaixo do ponto de reposição? | MM.STOCK.READ |
| `custo_estimado_de_reposicao` | Qual é o custo estimado de reposição? | MM.MRP.RUN ou MM.STOCK.READ |
| `pedidos_de_compra_atrasados` | Quais pedidos de compra estão atrasados? | MM.PURCHASE_ORDER.READ |
| `fornecedores_com_pedidos_pendentes` | Quais fornecedores possuem pedidos pendentes? | MM.PURCHASE_ORDER.READ |
| `vendas_por_categoria` | Qual categoria vendeu mais? | SD.BILLING.READ |
| `pedidos_de_venda_nao_entregues` | Quais pedidos de venda ainda não foram entregues? | SD.SALES_ORDER.READ |
| `pedidos_de_venda_nao_faturados` | Quais pedidos ainda não foram faturados? | SD.SALES_ORDER.READ |

## 6. n8n (projeto Copiloto)
Ficam em `integrations/n8n/` neste repositório:
- `10-erp-eventos.json`: Webhook `POST /webhook/erp-eventos` → **confere a assinatura HMAC** → separa por evento → monta o alerta (estoque baixo para Compras, pedido aprovado, fatura emitida…) → responde 200.
- `11-erp-resumo-diario.json`: todo dia às 7h → `GET /api/kpis/summary` com a chave de API → resumo operacional.

## 7. Novas permissões
`ADMIN.INTEGRATION.READ`, `ADMIN.INTEGRATION.MAINTAIN` e `AI.ASSISTANT.USE`.
O `AI.ASSISTANT.USE` fica em todas as roles de negócio e no auditor. O que cada pessoa vê pela IA continua limitado pelas permissões que ela já tem.

## 8. Critérios de aceitação
- **Cenário 14:** um documento gera o evento, o receptor (n8n) recebe o POST assinado, e a entrega fica `SUCCESS` no log.
- Um receptor fora do ar gera novas tentativas e, por fim, a entrega fica `DEAD`.
- Uma chave de API só lê, respeita role e escopo, e a chave revogada responde 401.
- Repetir um `POST` com a mesma `Idempotency-Key` não duplica o documento.
- **Cenário 15:** a IA responde a partir das ferramentas e mostra a fonte. O vendedor não obtém dados de compras pela IA.
