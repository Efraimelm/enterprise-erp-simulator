# Etapa 4: Desenho do módulo SD (Sales and Distribution)

Simulação **simplificada** de vendas, expedição, faturamento e contas a receber, inspirada no SAP S/4HANA. Não é o SD nem o FI da SAP.

## 1. Processo de ponta a ponta

```
 Pedido de venda ──► ATP + aprovação* ──► Confirmado (reserva) ──► Entrega ──► Separação ──► Saída 601 ──► Fatura ──► Título ──► Pagamento
 00xxxxxxxx           disponível ≥ pedido?   reserved_qty += q      80xxxxxxxx   (picking)    49xxxxxxxx    90xxxxxxxx  a receber   14xxxxxxxx
                                                                                         físico −q, reservado −q            (simulado)
 * total até o limite (parâmetro so_approval_limit) confirma direto; acima, outra pessoa com SD.SALES_ORDER.APPROVE aprova
```

| Passo | Conceito SAP de referência | Tela |
| --- | --- | --- |
| Cliente e áreas de venda do cliente | Parceiro de negócios (cliente) | Clientes |
| Preço e desconto | Registros de condição (VK11), muito simplificados | Condições comerciais |
| Pedido de venda | VA01 | Pedidos de venda |
| Verificação de disponibilidade | ATP, simplificado | Pedido → Verificar disponibilidade |
| Entrega, separação e saída de mercadoria | VL01N / picking / PGI (movimento 601) | Entregas |
| Faturamento e estorno | VF01 / VF11 | Faturamento |
| Título a receber e pagamento | FI-AR, simplificado (sem banco, sem contabilidade) | Contas a receber |

## 2. Regras de negócio

### Numeração
| Documento | Prefixo | Exemplo |
| --- | --- | --- |
| Pedido de venda | 00 | 0000000001 |
| Entrega | 80 | 8000000001 |
| Fatura e estorno | 90 | 9000000001 |
| Pagamento | 14 | 1400000001 |
| Saída de mercadoria | 49 (documento de material, o mesmo do MM) | 4900000010 |

### Preço, desconto e imposto
- **Preço (A2 do SD):** registro de condição por material e organização de vendas. Pode ser geral, por canal ou por cliente, sempre com validade. Vale o mais específico: **cliente → canal → geral**. Sem preço válido, o item é recusado.
- **Desconto:** percentual com validade. Vale o mais específico: **cliente + material → cliente → material → canal → geral**. Os descontos não se somam.
- **Imposto simulado:** código de imposto por item (padrão do parâmetro `sd_default_tax_code`). `líquido = qtd × preço − desconto` e `imposto = líquido × alíquota`.
- O preço, a origem do preço, o desconto e a alíquota ficam **gravados no item** (foto do momento), como no SAP.

### Validações do pedido
- Cliente ativo e liberado para a área de vendas (organização + canal + setor).
- O centro fornecedor é da mesma empresa da organização de vendas e está no escopo do usuário.
- O material está ativo e estendido para o centro.

### ATP simplificado e reserva (A10)
- `disponível = físico − reservado` no depósito do item.
- **Verificar disponibilidade** só consulta e não reserva.
- **Confirmar** reserva dentro da mesma transação, com `SELECT … FOR UPDATE` no saldo. Dois pedidos nunca reservam a mesma unidade (há teste de concorrência).
- **Atendimento parcial:** com `allow_partial = true`, confirma o que houver (`confirmed_qty < quantity`). Com `false`, recusa se faltar qualquer item.
- A reserva é liberada na saída de mercadoria (vira baixa) ou no cancelamento.

### Aprovação (A6 no SD)
- Total bruto ≤ `so_approval_limit` (padrão R$ 5.000,00): confirma direto.
- Acima disso: `PENDING_APPROVAL`, e alguém com SD.SALES_ORDER.APPROVE, **diferente de quem criou**, aprova (e então reserva).

### Status do pedido
`DRAFT → PENDING_APPROVAL → CONFIRMED → IN_DELIVERY → PARTIALLY_DELIVERED → DELIVERED → BILLED`, ou `CANCELLED`.
O status é recalculado a partir das quantidades dos itens. "Faturado" significa entregue por completo e faturado por completo.

### Entrega
- É criada a partir de um pedido confirmado, com uma quantidade de até `confirmado − já em entregas` por item. Pode ser parcial.
- **Separação (picking) simulada:** confirma a quantidade separada, que pode ser menor.
- **Saída de mercadoria:** movimento **601**. Baixa o físico e o reservado da quantidade separada, soma em `delivered_qty`, registra o responsável e a data, e muda o status da entrega para `POSTED`.
- Uma entrega ainda não lançada pode ser excluída. A reserva continua no pedido.

### Faturamento (A4) e estorno (A11)
- Uma fatura por entrega lançada (`POSTED`), com os preços gravados no pedido.
- Ao faturar, gera **um título a receber**. O vencimento é a data da fatura mais o prazo da condição de pagamento.
- **Estorno** (SD.BILLING.CANCEL, com motivo):
  - gera um documento `CANCELLATION` com valores negativos, que referencia a fatura original;
  - a original fica `CANCELLED`, e o título também;
  - a entrega pode ser faturada de novo.
- Fatura com título já pago (total ou parcialmente) **não** pode ser estornada. O pagamento teria de ser estornado antes, o que fica fora da v1.

### Contas a receber (simulado)
- Status do título: `OPEN`, `PARTIALLY_PAID`, `PAID` ou `CANCELLED`. Fica **atrasado** quando a data de hoje passa do vencimento e o título está aberto.
- **Pagamento simulado** (SD.PAYMENT.POST): valor até o saldo em aberto, data e forma de pagamento (PIX, BOLETO ou TRANSFERÊNCIA). Não há integração bancária nem lançamento contábil.

### Escopo e permissões
- Pedidos, entregas, faturas e títulos seguem o **centro** do pedido.
- Clientes e condições são cadastros globais. Novas permissões: `SD.BILLING.READ` e `SD.RECEIVABLE.READ`.

## 3. Entidades (migration `006_sd`)
`customers`, `customer_sales_areas`, `product_prices`, `price_discounts`, `sales_orders`, `sales_order_items`, `deliveries`, `delivery_items`, `billing_documents`, `billing_items`, `accounts_receivable`, `payments`.
A reserva usa `stock_balances.reserved_qty`. A regra a manter é que **o reservado de cada depósito é igual à soma de (confirmado − entregue) dos itens abertos** (há teste para isso).

## 4. Critérios de aceitação (cenários da especificação)
4. Pedido de venda com verificação de disponibilidade.
5. Confirmar o pedido e reservar estoque, inclusive com concorrência.
6. Entrega parcial com registro da saída.
7. O estoque do MM é atualizado depois da saída do SD (físico e reservado).
8. Faturar e gerar o título a receber.
9. Registrar pagamento e quitar o título.
Mais: estorno, separação de funções, escopo por centro e permissões nas rotas reais.
