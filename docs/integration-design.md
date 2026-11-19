# Etapa 5: Integração MM + SD e trilha de documentos

## 1. O que já estava integrado (Etapas 3 e 4)
- **Um único cadastro de material** e **um único saldo** (`stock_balances`) para compra e venda.
- **Um único serviço de estoque** (`postMaterialDocument`):
  - o recebimento de compra (101) soma ao saldo;
  - a saída para o cliente (601) baixa o físico e a reserva do pedido de venda;
  - os dois geram documentos de material da mesma numeração (49…).
- Regras testadas em todos os depósitos: `físico = Σ movimentos` e `reservado = Σ (confirmado − entregue)`.

## 2. O que esta etapa acrescenta
1. **Trilha de documentos de ponta a ponta** (cenário 10). A partir de qualquer documento, mostra de onde ele veio e para onde foi:
   ```
   Requisição ─► Pedido de compra ─► Recebimento (101) ═FIFO═► Saída (601) ◄─ Entrega ◄─ Pedido de venda ─► Fatura ─► Título ─► Pagamento
   ```
2. **Busca global** pelo número de qualquer documento, na barra superior. Identifica o tipo pela tabela onde o número existe.
3. **Teste integrado** do ciclo completo: cadastro → compra → recebimento → venda → entrega → fatura → pagamento → trilha.

## 3. Como compra e venda se ligam: FIFO simulado
O simulador não controla **lote** nem **número de série**. Para mostrar "de qual compra veio o que foi vendido", a trilha aplica **FIFO (primeiro que entra, primeiro que sai)** sobre os movimentos de cada material × depósito, em ordem de lançamento:

- cada entrada (101, 561, 701 e a entrada do 311) vira uma "camada" com a quantidade que entrou;
- cada saída (601, 201, 702 e a saída do 311) consome as camadas mais antigas primeiro;
- a transferência 311 liga a saída do depósito de origem à entrada do depósito de destino, porque estão no mesmo documento.

Exemplo: recebimentos de 10 (PC A) e de 10 (PC B), depois uma venda de 15 → a saída 601 "veio" 10 do PC A e 5 do PC B.

> **Atenção:** é uma **atribuição calculada para fins de rastreabilidade didática**. Não é controle de lote, não é custeio e não é o *document flow* do SAP. A tela e a API dizem isso.

## 4. Decisões
| # | Decisão | Motivo |
| --- | --- | --- |
| D28 | Trilha montada por **consulta** às chaves que já existem, **sem** tabela `document_links` | Todo vínculo já está gravado nos documentos (item da RC → item do PC, recebimento → PC, movimento → origem, entrega → pedido, fatura → entrega, título → fatura, pagamento → título). Uma tabela de vínculos duplicaria isso, e a especificação pede para evitar duplicação |
| D29 | Ligação compra ↔ venda por **FIFO simulado** sobre os movimentos | Sem lote, é a forma mais simples e determinística de responder "de onde veio". O cálculo é refeito a cada consulta, nunca gravado |
| D30 | A trilha respeita **escopo e permissões**. Documento de outro centro, ou de um tipo que o usuário não pode ler, não aparece, e a trilha não passa por ele. A tela mostra apenas quantos foram ocultados | A especificação proíbe revelar dados fora do escopo |
| D31 | Limite de 150 documentos por trilha, com aviso de "trilha truncada" | Um documento de carga inicial pode alimentar dezenas de vendas. O limite mantém a tela legível e a consulta rápida |

## 5. API
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/api/flow/search?q=` | logado | Encontra documentos pelo número (exato ou prefixo, até 20) e devolve `{ type, id, number, label }` |
| GET | `/api/flow/:type/:id` | leitura do tipo + escopo | Grafo `{ root, nodes[], edges[], hidden, truncated }`. `type`: `PURCHASE_REQ`, `PURCHASE_ORDER`, `MATERIAL_DOC`, `SALES_ORDER`, `DELIVERY`, `BILLING`, `RECEIVABLE`, `PAYMENT` |

Permissão por tipo de nó: RC → `MM.PURCHASE_REQ.READ` · PC → `MM.PURCHASE_ORDER.READ` · documento de material → `MM.STOCK.READ` · pedido de venda e entrega → `SD.SALES_ORDER.READ` · fatura → `SD.BILLING.READ` · título e pagamento → `SD.RECEIVABLE.READ`.

## 6. Critérios de aceitação
- Cenário 10: do **pagamento** chega-se à **requisição de compra**, e da requisição ao pagamento, no mesmo grafo.
- O FIFO atribui corretamente uma venda que consome dois recebimentos.
- A transferência 311 continua a trilha no outro depósito.
- Um usuário sem permissão de MM vê a parte de vendas e um contador de documentos ocultos. Um usuário de outro centro recebe 403.
- A busca global encontra cada tipo de documento pelo número.
