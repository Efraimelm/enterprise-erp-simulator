# Etapa 7: BI, relatórios e Power BI

## 1. O que entra
1. **API de relatórios** (`/api/reports/...`). Cada relatório:
   - é tabular, com filtros de período e centro;
   - traz totais e a **definição (fórmula)**;
   - respeita permissão e escopo;
   - pode ser exportado em **CSV** e lido inteiro (`all=true`) pelo Power BI.
2. **Tela Relatórios** no ERP: filtros, tabela, gráfico simples e exportação CSV.
3. **Pacote Power BI** em `analytics/`:
   - consultas Power Query (M) que leem a API com a chave INTEGRATION_READONLY;
   - medidas DAX com as mesmas fórmulas;
   - o passo a passo do Power BI Desktop.

> Não há arquivo `.pbix` no repositório. Ele é binário e precisa do Power BI Desktop para ser montado. O passo a passo e as consultas permitem recriá-lo em poucos minutos.

## 2. Relatórios e fórmulas

| Relatório | Permissão | Fórmula / regra |
| --- | --- | --- |
| **Posição de estoque** (`stock-position`) | MM.STOCK.READ | Por material × depósito: físico, reservado, `disponível = físico − reservado`, `valor = físico × preço de referência` (avaliação simulada, **não** é custo contábil) e indicador `abaixo do ponto` (disponível do centro ≤ ponto de reposição) |
| **Giro de estoque** (`stock-turnover`) | MM.STOCK.READ | Período [de, até] (padrão: 90 dias). Por material × centro: `inicial = Σ movimentos < de`, `final = Σ movimentos ≤ até`, `saídas = Σ |qtd|` dos tipos 601, 201 e 702 no período (transferência 311 é interna e não conta), `entradas` dos tipos 101, 561 e 701, `médio = (inicial + final) / 2`, `giro = saídas / médio`, `cobertura (dias) = final ÷ (saídas / dias do período)` |
| **Compras por fornecedor** (`purchases-by-supplier`) | MM.PURCHASE_ORDER.READ | Pedidos não cancelados criados no período: quantidade, valor bruto, `valor recebido = Σ recebido × preço × (1 + imposto)`, `% recebido` e **pontualidade** (pedidos totalmente recebidos cujo último recebimento foi até a data de entrega ÷ pedidos totalmente recebidos) |
| **Pedidos de compra pendentes** (`open-purchase-orders`) | MM.PURCHASE_ORDER.READ | Status APPROVED, SENT ou PARTIALLY_RECEIVED. `valor pendente = Σ (pedido − recebido) × preço × (1 + imposto)`. `dias de atraso = hoje − data de entrega` (se positivo) |
| **Vendas por período** (`sales-by-period`) | SD.BILLING.READ | Faturas **ativas** (não estornadas), agrupadas por dia ou mês da data da fatura e por categoria do material: líquido, imposto, bruto e quantidade. Fatura estornada sai do relatório |
| **Pedidos de venda em aberto** (`open-sales-orders`) | SD.SALES_ORDER.READ | Status CONFIRMED, IN_DELIVERY ou PARTIALLY_DELIVERED. `pendente = Σ (pedido − entregue)`, `valor pendente = Σ pendente × preço × (1 − desconto) × (1 + imposto)`, entregas sem saída e dias de atraso em relação à data desejada |
| **Contas a receber por vencimento** (`receivables-aging`) | SD.RECEIVABLE.READ | Títulos OPEN ou PARTIALLY_PAID na data de hoje. `em aberto = valor − pago`. Faixas por `dias = hoje − vencimento`: **a vencer** (≤ 0), **1–30**, **31–60**, **61–90** e **> 90**. Por cliente e total |

Regras gerais:
- **Escopo:** sempre limitado aos centros do usuário ou da chave. O filtro `plant_id` fora do escopo responde 403.
- **Período:** `from` e `to` em `AAAA-MM-DD`, com 366 dias no máximo. Sem período: os últimos 90 dias.
- **CSV** (`format=csv`):
  - UTF-8 com BOM, separador `;` e cabeçalhos em português, para abrir direto no Excel em pt-BR;
  - `decimal=comma` (padrão) ou `dot`.
- **Power BI** (`all=true`): devolve todas as linhas, até 20.000. Acima disso, responde 400 e pede para filtrar.

## 3. Decisões
| # | Decisão | Motivo |
| --- | --- | --- |
| D39 | Relatórios calculados no backend, com a fórmula na resposta | O ERP, o n8n, a IA e o Power BI mostram o mesmo número, rastreável até a regra |
| D40 | Estoque avaliado pelo **preço de referência** | O simulador não tem custeio (FI/CO). Fica explícito que é uma avaliação simulada |
| D41 | Vendas pelo faturamento **ativo** (faturas estornadas saem) | Regra simples e sem dupla contagem. Não é o critério contábil de competência do estorno |
| D42 | Power BI pela API (`all=true` + chave somente leitura), sem acesso direto ao banco | Mantém permissões, escopo e log de acesso. O banco nunca fica exposto |

## 4. Critérios de aceitação
- Valores conferidos com dados controlados em teste:
  - estoque e valor;
  - giro e cobertura;
  - compras e pontualidade;
  - vendas por mês e categoria (com estorno excluído);
  - faixas de vencimento.
- O CSV abre no Excel: BOM, `;` e decimal com vírgula.
- Relatório sem permissão → 403. Centro fora do escopo → 403. A chave de integração lê com `all=true`.
