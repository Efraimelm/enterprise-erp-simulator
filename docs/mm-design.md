# Etapa 3: Desenho do módulo MM (Materials Management)

Simulação **simplificada** de processos de MM, inspirada no SAP S/4HANA. Não é uma implementação do MM da SAP.

## 1. Processo de ponta a ponta

```
 MRP simplificado ──► Requisição (RC) ──► aprovação ──► Pedido de compra (PC) ──► aprovação* ──► envio ──► Recebimento (EM)
 (sugestões, aprovação     10xxxxxxxx        (outra       45xxxxxxxx                                       49xxxxxxxx
  humana)                                    pessoa)                                                      ↓
                                                                                       saldo de estoque + movimento 101
 * pedido até o limite de aprovação (parâmetro) é aprovado automaticamente; acima, precisa de quem tem MM.PURCHASE_ORDER.APPROVE
```

| Passo | Conceito SAP de referência | Tela no simulador |
| --- | --- | --- |
| Cadastro de material e dados por centro | MM01/MM02 (visões de compras e MRP) | Materiais |
| Cadastro de fornecedor | Parceiro de negócios (fornecedor) | Fornecedores |
| Preço do fornecedor por material | Registro info (ME11) | Fornecedores → materiais |
| Requisição de compra e aprovação | ME51N / ME54N | Requisições de compra |
| Pedido de compra e aprovação | ME21N / ME29N | Pedidos de compra |
| Recebimento de mercadorias | MIGO, movimento 101 | Recebimentos |
| Estoque por depósito | MMBE | Estoque |
| Movimentos manuais | MIGO, movimentos 201/311/561 | Estoque → Movimentar |
| Inventário | MI01/MI04/MI07, movimentos 701/702 | Estoque → Inventário |
| Planejamento de necessidades | MD01 (MRP), muito simplificado | MRP |

## 2. Regras de negócio

### Numeração (A8)
Tabela `document_sequences`, com o número gerado **dentro da transação** e travado por linha (sem buracos nem duplicidade):

| Documento | Prefixo | Exemplo |
| --- | --- | --- |
| Requisição de compra | 10 | 1000000001 |
| Pedido de compra | 45 | 4500000001 |
| Documento de material (todo movimento de estoque, inclusive recebimento) | 49 | 4900000001 |
| Documento de inventário | 01 | 0100000001 |

### Estoque
- Saldo por **material × depósito** (o depósito pertence a um centro): `físico`, `reservado` (usado pelo SD na Etapa 4) e `disponível = físico − reservado`.
- **Todo** saldo muda junto com uma linha em `stock_movements`, na mesma transação, com documento, tipo de movimento, responsável, data e motivo. Não existe rota para editar o saldo diretamente.
- Saídas não podem deixar o **disponível** negativo. Para isso, a linha do saldo é travada com `SELECT … FOR UPDATE`, a tabela tem `CHECK (physical_qty >= 0)` e há repetição automática em caso de deadlock.

| Tipo | Significado | Quem lança |
| --- | --- | --- |
| 101 | Entrada por pedido de compra | Recebimento (MM.GOODS_RECEIPT.POST) |
| 561 | Entrada inicial / ajuste de entrada | Manual (MM.STOCK.ADJUST + justificativa) |
| 201 | Saída para consumo | Manual (MM.STOCK.ADJUST + justificativa) |
| 311 | Transferência entre depósitos do mesmo centro | Manual (MM.STOCK.ADJUST + justificativa) |
| 701 / 702 | Sobra / falta de inventário | Inventário (MM.STOCK.ADJUST + justificativa) |

### Requisição de compra
- Status: `PENDING_APPROVAL` → `APPROVED` → `CONVERTED` (virou pedido), ou `REJECTED` / `CANCELLED`.
- Quem aprova precisa de MM.PURCHASE_REQ.APPROVE e **não pode ser o solicitante** (separação de funções).
- Rejeitar exige motivo. Só a requisição aprovada vira pedido.

### Pedido de compra
- Status: `DRAFT` → `PENDING_APPROVAL` → `APPROVED` → `SENT` → `PARTIALLY_RECEIVED` → `RECEIVED`, ou `CANCELLED`.
- Só se altera em `DRAFT`. Rejeitar devolve para `DRAFT`, com motivo.
- **Aprovação por valor (A6):** ao enviar para aprovação, um total bruto ≤ `po_approval_limit` (parâmetro, padrão R$ 1.000,00) é aprovado automaticamente. Acima disso, alguém com MM.PURCHASE_ORDER.APPROVE, **diferente de quem criou**, precisa aprovar.
- **Impostos simulados (A2):** cada item tem um código de imposto com percentual configurável. O valor bruto é o líquido mais o imposto. Não é cálculo fiscal real.
- **Moeda (A5):** a moeda é a da empresa do centro, sem conversão.
- Preço sugerido: registro info do fornecedor → senão, o preço de referência do material.
- Cancelar só sem recebimento, com MM.PURCHASE_ORDER.APPROVE e motivo.
- Validações:
  - fornecedor e material ativos;
  - material estendido para o centro;
  - depósito do mesmo centro;
  - organização de compras atribuída ao centro.

### Recebimento (A3)
- Só para pedido `APPROVED`, `SENT` ou `PARTIALLY_RECEIVED`. Pode ser total ou parcial, por item.
- Por padrão, não aceita quantidade acima da pendente. Com a permissão MM.GOODS_RECEIPT.OVERDELIVERY, aceita até a **tolerância de excesso do fornecedor** (%).
- Gera o documento de material (movimento 101), soma ao estoque, atualiza a quantidade recebida e muda o status do pedido.

### MRP simplificado (A7)
Para cada material × centro com ponto de reposição:

```
cobertura = disponível + pedidos em aberto (qualquer status exceto cancelado/recebido, quantidade ainda não recebida) + requisições abertas (aguardando aprovação ou aprovadas)
se cobertura <= ponto de reposição  →  sugerir  (estoque máximo − cobertura)   [se não houver máximo: 2 × ponto − cobertura]
```

As sugestões **não** viram documento sozinhas. Uma pessoa escolhe quais converter, e o sistema cria uma requisição por centro (origem `MRP`), que ainda passa pela aprovação. O MRP não considera datas, lead time, lote mínimo nem demanda prevista. Isso fica registrado como limitação.

### Escopo e permissões
- Todo documento de MM pertence a um **centro**: listas filtradas e 403 `OUT_OF_SCOPE` fora do escopo, como na Etapa 2.
- Material e fornecedor são cadastros **globais**. Os dados do material por centro seguem o escopo do centro.

## 3. Entidades (migration `005_mm`)

`document_sequences`, `tax_codes`, `payment_terms`, `materials`, `material_plant_data`, `suppliers`, `supplier_materials`, `stock_balances`, `stock_movements`, `goods_receipts`, `purchase_requisitions(_items)`, `purchase_orders(_items)`, `inventory_documents`, `inventory_items`.

Os itens de recebimento são as próprias linhas de `stock_movements` (tipo 101, ligadas ao item do pedido). Isso evita uma tabela `goods_receipt_items` duplicada.

## 4. Telas
Materiais · Fornecedores · Estoque (saldos, movimentos, movimentar, inventário) · Requisições de compra · Pedidos de compra · Recebimentos · MRP. Códigos de imposto e condições de pagamento entram nos cadastros de configuração.

## 5. Critérios de aceitação desta etapa
1. Cadastrar material e consultá-lo (cenário 1).
2. Criar requisição, aprovar e converter em pedido (cenário 2).
3. Receber parcialmente e conferir o estoque e o status do pedido (cenário 3).
4. Todo movimento tem documento, tipo, responsável e data (cenário 13, parte MM).
5. Vendedor, almoxarife e analista tentando operações de compra sem permissão → 403 (cenário 11, rotas reais).
6. Centro fora do escopo → 403 em documentos de MM (cenário 12).
7. Saídas simultâneas nunca deixam o estoque negativo (teste de concorrência).
8. Quem cria não aprova a própria requisição nem o próprio pedido.
