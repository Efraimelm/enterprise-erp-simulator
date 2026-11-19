# Modelo de dados

Banco MariaDB/MySQL, `utf8mb4`, datas em UTC. Toda tabela de cadastro tem `is_active`, `created_at`, `updated_at`, `created_by` e `updated_by`.

## Implementado na Etapa 1

### Segurança — `20261119_001_security.js`

| Tabela | Finalidade | Chaves e restrições |
| --- | --- | --- |
| `users` | Usuários | `username` e `email` únicos. `status` ACTIVE/BLOCKED/INACTIVE. Controle de tentativas (`failed_attempts`, `locked_until`). `must_change_password` |
| `roles` | Funções (ex.: SAP_ADMIN, AUDITOR) | `code` único |
| `permissions` | Permissões granulares (ex.: ADMIN.ORG.CREATE) | `code` único, `module` |
| `role_permissions` | Role × permissão | PK (role_id, permission_id), CASCADE |
| `user_roles` | Usuário × role | PK (user_id, role_id), CASCADE |
| `sessions` | Sessões de login | `token_hash` (SHA-256) único, `expires_at` indexado |
| `audit_logs` | Trilha de auditoria | Índices por data, por (entity, entity_id), por usuário e por ação. `details` em JSON |

### Estrutura organizacional — `20261119_002_org_structure.js`

```
companies ─1:N─ plants ─1:N─ storage_locations          (código do depósito é único dentro do centro)
companies ─1:N─ sales_organizations ─┐
               distribution_channels ┼─ sales_areas      (combinação única org+canal+setor)
               divisions ────────────┘
companies ─1:N─ purchasing_organizations ─N:N─ plants    (purchasing_org_plants)
purchasing_groups                                        (independente)
```

| Tabela | Conceito SAP de referência | Código | Campos principais |
| --- | --- | --- | --- |
| `companies` | Empresa (company code) | 4, único | razão social, CNPJ fictício, país, moeda, idioma, fuso |
| `plants` | Centro (plant) | 4, único | empresa, cidade, UF |
| `storage_locations` | Depósito (storage location) | 4, único por centro | centro |
| `sales_organizations` | Organização de vendas | 4, único | empresa, moeda |
| `distribution_channels` | Canal de distribuição | 2, único | — |
| `divisions` | Setor de atividade | 2, único | — |
| `sales_areas` | Área de vendas | — | org. de vendas + canal + setor (único) |
| `purchasing_organizations` | Organização de compras | 4, único | empresa |
| `purchasing_org_plants` | Atribuição org. compras × centro | — | par único |
| `purchasing_groups` | Grupo de compradores | 3, único | e-mail |

Todas as chaves estrangeiras usam `ON DELETE RESTRICT`: não dá para excluir uma empresa que tem centros.

### Escopo — `20261119_004_org_scopes.js` (Etapa 2)

| Tabela | Finalidade | Chaves e restrições |
| --- | --- | --- |
| `user_org_scopes` | Onde o usuário atua: `ALL`, `COMPANY` (empresa inteira) ou `PLANT` (centro) | FK para users (CASCADE), companies e plants (RESTRICT). CHECK garante que cada tipo preenche só a coluna certa |
| `roles.is_system` | Marca as roles de sistema (somente leitura na tela) | — |

Catálogo: 42 permissões e 9 roles de sistema. Ver [authorization.md](authorization.md).

### MM — `20261120_005_mm.js` (Etapa 3)

| Tabela | Finalidade | Destaques |
| --- | --- | --- |
| `document_sequences` | Faixas de numeração | Trava por linha na transação. RC 10…, PC 45…, doc. material 49…, inventário 01… |
| `tax_codes`, `payment_terms` | Configuração de compras (impostos simulados e prazos) | Mantidas na tela de configuração |
| `materials` | Material (código, tipo HAWA/ROH/HIBE, unidade, preço de referência, status) | A unidade não muda depois que o material é movimentado |
| `material_plant_data` | Dados do material por centro: depósito padrão, grupo de compradores, mínimo, ponto de reposição e máximo | Único por (material, centro). Segue o escopo do centro |
| `suppliers` | Fornecedor fictício, condição de pagamento e tolerância de excesso (%) | Status ACTIVE/BLOCKED/INACTIVE |
| `supplier_materials` | Registro info: preço e prazo do fornecedor por material | Único por (fornecedor, material) |
| `stock_balances` | Saldo físico e reservado por material × depósito | `CHECK (physical_qty >= 0 AND reserved_qty >= 0)`. Só o serviço de estoque altera |
| `stock_movements` | Linhas dos documentos de material (101, 201, 311, 561, 701, 702) | Quantidade com sinal. Referência ao documento de origem, responsável e data. O saldo é sempre a soma dos movimentos (testado) |
| `purchase_requisitions` / `_items` | Requisição de compra | Origem MANUAL ou MRP. Item ligado ao item do pedido gerado |
| `purchase_orders` / `_items` | Pedido de compra com totais e imposto simulado por item | Status de DRAFT a RECEIVED/CANCELLED, aprovação automática ou manual |
| `goods_receipts` | Cabeçalho do recebimento (= documento de material) | As linhas são as próprias `stock_movements` do tipo 101 |
| `inventory_documents` / `inventory_items` | Contagem física com saldo contábil, contado e diferença | As diferenças viram movimentos 701/702 |

Quantidades usam `DECIMAL(15,3)` e valores `DECIMAL(15,2)`. Datas de negócio (entrega, necessidade) usam `DATE`, devolvido como texto `AAAA-MM-DD`.

### SD — `20261120_006_sd.js` (Etapa 4)

| Tabela | Finalidade | Destaques |
| --- | --- | --- |
| `customers` | Cliente fictício, endereço de cobrança e de entrega, condição de pagamento | Status ACTIVE/BLOCKED/INACTIVE |
| `customer_sales_areas` | Em quais áreas de vendas (org. + canal + setor) o cliente pode comprar | Único por (cliente, área) |
| `product_prices` | Registro de condição de preço por material e org. de vendas, opcionalmente por canal e/ou cliente, com validade | Cliente > canal > geral |
| `price_discounts` | Desconto percentual com validade e combinações opcionais (cliente, material, canal) | Vale o mais específico |
| `sales_orders` / `_items` | Pedido de venda: área de vendas, centro fornecedor, totais e status. O item grava o preço, a origem do preço, o desconto e o imposto | `confirmed_qty` (reservado), `delivered_qty` e `billed_qty` |
| `deliveries` / `delivery_items` | Entrega: criada → separada → saída lançada (601) | `picked_qty` e o documento de material da saída |
| `billing_documents` / `billing_items` | Fatura (INVOICE) e estorno (CANCELLATION, com valores negativos e referência à original) | Status ACTIVE/CANCELLED |
| `accounts_receivable` | Título a receber (um por fatura): valor, pago, vencimento e status | `CHECK (0 ≤ pago ≤ valor)` |
| `payments` | Pagamento simulado (PIX, boleto, transferência) | Numeração 14… |

### Etapa 5: sem tabelas novas
A trilha de documentos é **consultada** a partir das chaves que já existem (decisão D28). A ligação recebimento ↔ saída é calculada por FIFO simulado sobre `stock_movements`. A tabela `document_links`, prevista no plano inicial, não foi criada para não duplicar vínculos. Ver [integration-design.md](integration-design.md).

**Reserva:** usa `stock_balances.reserved_qty`, sem tabela separada. A regra (testada) é que o reservado de cada depósito é igual à soma de (confirmado − entregue) dos itens de pedidos não cancelados. A saída 601 baixa o físico e o reservado juntos.

### Sistema — `20261119_003_system_settings.js`

| Tabela | Finalidade |
| --- | --- |
| `system_settings` | Parâmetros gerais (`setting_key` PK): idioma, fuso, moeda e formatos padrão |

### Dados de demonstração (seed)

Comércio Forte Ltda (CF01, BRL, pt-BR, America/Sao_Paulo):
- centros CF10 Matriz São Paulo e CF20 CD Campinas
- depósitos 0001 e 0002 em cada centro
- organização de vendas CF10
- canais 10 Varejo e 20 Atacado
- setores 01 Alimentos e 02 Bebidas (4 áreas de vendas)
- organização de compras CF10, atendendo os 2 centros
- grupos de compradores 001 e 002

Usuários: `admin` (SAP_ADMIN) e `auditor` (AUDITOR), com escopo ALL e senha provisória.

## Planejado

| Etapa | Tabelas |
| --- | --- |
| 6 | `integration_clients` (chaves de API, só o hash), `webhook_subscriptions`, `integration_logs`, `notifications` |

Regra que valerá a partir da Etapa 3: `stock_balances` **só** muda junto com uma linha em `stock_movements`, na mesma transação. Não haverá rota para editar o saldo diretamente.
