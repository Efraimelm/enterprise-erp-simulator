# API (Etapa 1)

Base: `http://localhost:5173/api` (pelo proxy do frontend) ou `http://127.0.0.1:3001/api`.
A documentação OpenAPI/Swagger completa entra na Etapa 6. Este arquivo é a referência até lá.

## Regras gerais

- **Autenticação:** cookie de sessão `erp_session`, criado no login.
- **Escrita** (POST, PUT, DELETE): envie o cabeçalho `X-ERP-Client: web` (proteção CSRF).
- **Erros:** `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "field": "currency", "message": "…" }] } }`

| Código HTTP | Quando |
| --- | --- |
| 400 | Dados inválidos (`details` traz o campo) |
| 401 | Não logado / sessão expirada / usuário ou senha inválidos |
| 403 | Sem permissão (`FORBIDDEN`), fora do escopo (`OUT_OF_SCOPE`), escalada de privilégio (`PRIVILEGE_ESCALATION`), alteração de si mesmo (`SELF_CHANGE`), role de sistema (`SYSTEM_ROLE`), senha provisória (`PASSWORD_CHANGE_REQUIRED`), usuário bloqueado ou CSRF |
| 404 | Rota ou registro não existe |
| 409 | Código duplicado (`DUPLICATE`) ou registro em uso (`IN_USE`) |
| 422 | Referência para registro inexistente (`INVALID_REFERENCE`) |
| 423 | Conta bloqueada temporariamente por tentativas erradas |
| 429 | Muitas tentativas de login |

## Endpoints

### Saúde
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ status, database, environment, time }` |

### Autenticação
| Método | Rota | Permissão | Corpo / resposta |
| --- | --- | --- | --- |
| POST | `/auth/login` | — | `{ username, password }` → `{ user }` + cookie |
| POST | `/auth/logout` | — | 204 |
| GET | `/auth/me` | logado | `{ user: { id, username, full_name, roles[], permissions[], scopes[], must_change_password } }` |
| POST | `/auth/change-password` | logado | `{ current_password, new_password }` → `{ user }`. Encerra as outras sessões |

### Estrutura organizacional
`:entity` = `companies`, `plants`, `storage-locations`, `sales-organizations`, `distribution-channels`, `divisions`, `sales-areas`, `purchasing-organizations`, `purchasing-org-plants` ou `purchasing-groups`.

| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/org/meta` | ADMIN.ORG.READ | Campos e regras de cada entidade |
| GET | `/org/:entity` | ADMIN.ORG.READ | Lista. Parâmetros: `page`, `pageSize` (máx. 100), `q` (busca em código/nome), `sort`, `order`, filtros por campo de referência (ex.: `company_id=1`) e `is_active` |
| GET | `/org/:entity/:id` | ADMIN.ORG.READ | Um registro |
| POST | `/org/:entity` | ADMIN.ORG.CREATE | Cria. Campos desconhecidos são recusados |
| PUT | `/org/:entity/:id` | ADMIN.ORG.UPDATE | Altera (envie todos os campos) |
| DELETE | `/org/:entity/:id` | ADMIN.ORG.DELETE | Exclui, só se não houver vínculos. Senão, responde 409 |

Exemplo de lista: `GET /api/org/plants?company_id=1&is_active=true&sort=code`
```json
{ "data": [{ "id": 1, "code": "CF10", "name": "Matriz São Paulo", "company_id": 1, "city": "São Paulo", "state": "SP", "is_active": true, "...": "..." }],
  "page": 1, "pageSize": 20, "total": 2 }
```

As listas trazem só o que está no escopo do usuário. Abrir ou alterar um registro fora do escopo responde 403 `OUT_OF_SCOPE`.

### Usuários (Etapa 2)
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/admin/users` | ADMIN.USER.READ | Filtros: `q`, `status`, `role`, `page`, `pageSize`. Cada usuário vem com `roles[]` e `scopes[]` |
| GET | `/admin/users/:id` | ADMIN.USER.READ | Detalhe |
| POST | `/admin/users` | ADMIN.USER.CREATE (+ ADMIN.ROLE.ASSIGN para roles/escopo) | `{ username, full_name, email?, roles[], scopes[] }` → `{ data, temporaryPassword }`. A senha só aparece aqui |
| PUT | `/admin/users/:id` | ADMIN.USER.UPDATE | `{ full_name, email }` |
| POST | `/admin/users/:id/status` | ADMIN.USER.UPDATE | `{ status: "ACTIVE" \| "BLOCKED" \| "INACTIVE", reason }`. Encerra as sessões |
| POST | `/admin/users/:id/reset-password` | ADMIN.USER.UPDATE | → `{ data, temporaryPassword }`. Desbloqueia e encerra as sessões |
| PUT | `/admin/users/:id/roles` | ADMIN.ROLE.ASSIGN | `{ roles: ["PROCUREMENT"] }` |
| PUT | `/admin/users/:id/scopes` | ADMIN.ROLE.ASSIGN | `{ scopes: [{ type: "ALL" } \| { type: "COMPANY", company_id } \| { type: "PLANT", plant_id }] }` |

### Roles e permissões (Etapa 2)
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/admin/permissions` | ADMIN.ROLE.READ | Catálogo (41) |
| GET | `/admin/roles` | ADMIN.ROLE.READ | Roles com `permissions[]`, `user_count` e `is_system` |
| POST | `/admin/roles` | ADMIN.ROLE.MAINTAIN | `{ code: "Z_…", name, description?, permissions[] }` |
| PUT | `/admin/roles/:id` | ADMIN.ROLE.MAINTAIN | Só para roles personalizadas |
| DELETE | `/admin/roles/:id` | ADMIN.ROLE.MAINTAIN | Só para roles personalizadas sem usuários |

### Parâmetros gerais
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/settings` | ADMIN.SETTINGS.READ | Lista os parâmetros |
| PUT | `/settings/:key` | ADMIN.SETTINGS.UPDATE | `{ value }`, validado conforme o parâmetro |

### Auditoria
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/audit` | ADMIN.AUDIT.READ | Filtros: `username`, `action`, `entity`, `result`, `from`, `to`, `page`, `pageSize` |

## MM (Etapa 3)

Regras de negócio em [mm-design.md](mm-design.md). Todos os documentos seguem o escopo do centro (403 `OUT_OF_SCOPE`). Erros de MM: 409 `INVALID_STATUS` (transição não permitida), 409 `INSUFFICIENT_STOCK`, 403 `SEGREGATION_OF_DUTIES` (aprovar o que você mesmo criou), 409 `HAS_RECEIPTS` (cancelar pedido já recebido).

### Cadastros
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/mm/materials` | MM.MATERIAL.READ | Filtros: `q`, `status`, `type`, `plant_id` |
| GET | `/mm/materials/:id` | MM.MATERIAL.READ | Com `plants[]`, `stock[]`, `suppliers[]` e `history[]` |
| POST / PUT | `/mm/materials`, `/mm/materials/:id` | MM.MATERIAL.CREATE / UPDATE | `{ code, description, material_type: HAWA\|ROH\|HIBE, category?, base_unit, reference_price }` |
| POST | `/mm/materials/:id/status` | MM.MATERIAL.UPDATE | `{ status, reason }` |
| PUT | `/mm/materials/:id/plants/:plantId` | MM.MATERIAL.UPDATE + escopo | `{ default_storage_location_id?, purchasing_group_id?, min_stock, reorder_point, max_stock }` |
| GET | `/mm/suppliers`, `/mm/suppliers/:id` | MM.SUPPLIER.READ | O detalhe traz `materials[]` (registros info), `orders[]` e `history[]` |
| POST / PUT | `/mm/suppliers`, `/mm/suppliers/:id` | MM.SUPPLIER.CREATE / UPDATE | Dados fictícios + `payment_term_id`, `overdelivery_tolerance_pct` |
| POST | `/mm/suppliers/:id/status` | MM.SUPPLIER.UPDATE | `{ status, reason }` |
| PUT / DELETE | `/mm/suppliers/:id/materials/:materialId` | MM.SUPPLIER.UPDATE | Registro info `{ net_price, lead_time_days, supplier_material_code? }` |

### Estoque
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/mm/stock` | MM.STOCK.READ | Saldos com `physical_qty`, `reserved_qty` e `available_qty`. Filtros: `q`, `plant_id`, `storage_location_id`, `material_id`, `below_reorder=true` |
| GET | `/mm/stock/movements` | MM.STOCK.READ | Filtros: `material_id`, `plant_id`, `movement_type`, `doc_number`, `reference_type`, `reference_id` |
| GET | `/mm/material-documents/:number` | MM.STOCK.READ | Documento de material com as linhas |
| POST | `/mm/stock/movements` | MM.STOCK.ADJUST | `{ movement_type: "561"\|"201", material_id, plant_id, storage_location_id, quantity, reason }` ou `311` com `to_storage_location_id` |
| GET | `/mm/inventory`, `/mm/inventory/:id` | MM.STOCK.READ | Documentos de inventário |
| POST | `/mm/inventory` | MM.STOCK.ADJUST | `{ plant_id, storage_location_id, reason, items: [{ material_id, counted_qty }] }` → diferenças em 701/702 |

### Compras
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/mm/purchase-requisitions[/:id]` | MM.PURCHASE_REQ.READ | Filtros: `status`, `plant_id`, `source`, `mine`, `q` |
| POST | `/mm/purchase-requisitions` | MM.PURCHASE_REQ.CREATE | `{ plant_id, justification, items: [{ material_id, quantity, storage_location_id?, need_date }] }` |
| POST | `/mm/purchase-requisitions/:id/approve` | MM.PURCHASE_REQ.APPROVE | O solicitante não pode aprovar |
| POST | `/mm/purchase-requisitions/:id/reject` / `cancel` | APPROVE / solicitante | `{ reason }` |
| GET | `/mm/purchase-orders[/:id]` | MM.PURCHASE_ORDER.READ | Filtros: `status`, `plant_id`, `supplier_id`, `q`, `open_for_receipt`. O detalhe traz `items[]` com `open_qty`, `requisitions[]`, `receipts[]` e `history[]` |
| POST | `/mm/purchase-orders` | MM.PURCHASE_ORDER.CREATE | `{ supplier_id, purchasing_organization_id, purchasing_group_id?, plant_id, payment_term_id?, delivery_date, notes?, items: [{ material_id, quantity, unit_price?, tax_code_id?, storage_location_id? }] }` |
| POST | `/mm/purchase-orders/from-requisition` | MM.PURCHASE_ORDER.CREATE | `{ requisition_id, supplier_id, purchasing_organization_id, purchasing_group_id?, tax_code_id?, delivery_date? }` |
| PUT | `/mm/purchase-orders/:id` | MM.PURCHASE_ORDER.CREATE | Só em rascunho |
| POST | `/mm/purchase-orders/:id/submit` · `send` | MM.PURCHASE_ORDER.CREATE | Envia para aprovação (automática até o limite) · envio simulado |
| POST | `/mm/purchase-orders/:id/approve` · `reject` · `cancel` | MM.PURCHASE_ORDER.APPROVE | Quem criou não aprova. `reject` e `cancel` exigem `{ reason }` |
| GET | `/mm/goods-receipts[/:id]` | MM.STOCK.READ ou MM.PURCHASE_ORDER.READ | Recebimentos |
| POST | `/mm/goods-receipts` | MM.GOODS_RECEIPT.POST | `{ purchase_order_id, notes?, items: [{ purchase_order_item_id, quantity, storage_location_id? }] }` |
| POST | `/mm/mrp/run` | MM.MRP.RUN | `{ plant_id? }` → sugestões com cobertura e melhor fornecedor |
| POST | `/mm/mrp/convert` | MM.MRP.RUN + MM.PURCHASE_REQ.CREATE | `{ items: [{ material_id, plant_id, quantity }] }` → requisições de origem MRP |
