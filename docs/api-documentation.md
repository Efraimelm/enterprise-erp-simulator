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
| 403 | Sem permissão, senha provisória (`PASSWORD_CHANGE_REQUIRED`), usuário bloqueado ou CSRF |
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
| GET | `/auth/me` | logado | `{ user: { id, username, full_name, roles[], permissions[], must_change_password } }` |
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

### Parâmetros gerais
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/settings` | ADMIN.SETTINGS.READ | Lista os parâmetros |
| PUT | `/settings/:key` | ADMIN.SETTINGS.UPDATE | `{ value }`, validado conforme o parâmetro |

### Auditoria
| Método | Rota | Permissão | Descrição |
| --- | --- | --- | --- |
| GET | `/audit` | ADMIN.AUDIT.READ | Filtros: `username`, `action`, `entity`, `result`, `from`, `to`, `page`, `pageSize` |
