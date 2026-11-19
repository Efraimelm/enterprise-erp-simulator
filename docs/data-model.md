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

Catálogo: 41 permissões e 9 roles de sistema. Ver [authorization.md](authorization.md).

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
| 3 | `materials`, `material_plant_data`, `suppliers`, `supplier_materials`, `payment_terms`, `tax_codes`, `document_sequences`, `purchase_requisitions(_items)`, `purchase_orders(_items)`, `goods_receipts(_items)`, `stock_balances`, `stock_movements`, `inventory_documents` |
| 4 | `customers`, `product_prices`, `price_conditions`, `sales_orders(_items)`, `stock_reservations`, `deliveries`, `delivery_items`, `billing_documents`, `billing_items`, `accounts_receivable`, `payments` |
| 5 | `document_links` (fluxo de documentos origem → destino) |
| 6 | `integration_clients` (chaves de API, só o hash), `webhook_subscriptions`, `integration_logs`, `notifications` |

Regra que valerá a partir da Etapa 3: `stock_balances` **só** muda junto com uma linha em `stock_movements`, na mesma transação. Não haverá rota para editar o saldo diretamente.
