# Casos de teste

Rodar: `npm test`. Os testes recriam o banco `erp_test` do zero e nunca tocam no `erp_dev`.

## Etapa 1: resultado em 19/11/2026: **38 testes, 38 aprovados**

### `backend/tests/auth.test.js` (16)
| Caso | Esperado |
| --- | --- |
| Health check | 200, banco ok |
| Rota inexistente | 404 JSON |
| Login correto | 200, cookie `HttpOnly` + `SameSite=Strict`, permissões no retorno, sem `password_hash`, auditoria SUCCESS |
| Token da sessão | Banco guarda só o hash SHA-256, nunca o token |
| Senha errada × usuário inexistente | Mesma resposta 401. Auditoria FAILURE sem a senha digitada |
| 5 senhas erradas | Conta bloqueada (423), mesmo com a senha certa depois |
| Usuário BLOCKED | 403 `USER_BLOCKED` + auditoria DENIED |
| Usuário bloqueado com sessão aberta | Sessão deixa de valer (401) |
| Rate limit | 4ª tentativa com limite 3 → 429 |
| Corpo inválido | 400 com os campos `username` e `password` |
| `/me` sem login | 401 |
| Logout | Sessão encerrada |
| POST sem `X-ERP-Client` | 403 `CSRF_REJECTED` |
| POST de outra origem | 403 |
| Senha provisória | Bloqueia a API até a troca. Senha fraca → 400, senha atual errada → 400, troca ok → acesso liberado |
| Senha com o nome de usuário | 400 |

### `backend/tests/org.test.js` (16)
| Caso | Esperado |
| --- | --- |
| Seed | CF01 com os centros CF10 e CF20 |
| `/meta` | 10 entidades. O campo `company_id` do centro é uma referência |
| Criar empresa | 201, `br`→`BR`, `brl`→`BRL`, auditoria CREATE |
| Moeda/fuso/nome inválidos | 400 com os 3 campos |
| Campos extras (`id`, `created_by`) | 400 |
| Código duplicado | 409 `DUPLICATE` |
| Alterar | 200. A auditoria registra só o campo que mudou (de → para) |
| Paginação | Respeita `pageSize` e devolve o `total` |
| Registro / entidade inexistente | 404 |
| Centro com empresa inexistente | 422 |
| Excluir empresa com centro | 409 `IN_USE`. Excluir depósito sem vínculo → 204 + auditoria |
| Código de depósito | Pode repetir em outro centro, não no mesmo |
| Área de vendas repetida | 409 |
| Auditor tenta criar | 403 + auditoria DENIED com a permissão exigida |
| Usuário sem role | 403 em org, settings e audit |
| API sem login | 401 em GET e DELETE |

### `backend/tests/settings-audit.test.js` (6)
| Caso | Esperado |
| --- | --- |
| Listar parâmetros | 5 parâmetros |
| Auditor altera | 403 |
| Valores inválidos / parâmetro inexistente | 400 / 404 |
| Admin altera fuso | 200 |
| Filtrar auditoria | Só LOGIN + SUCCESS |
| Vazamento | Nenhum registro de auditoria contém senha ou hash |

### Teste manual no navegador (19/11/2026)
1. Login → painel com 1 empresa, 2 centros, 4 depósitos, 4 áreas de vendas, 1 org. de compras e 2 grupos.
2. Centros → **Novo**, com código `cf 3` e sem nome nem empresa → mensagens embaixo de cada campo.
3. Corrigido para `cf30`, Loja Hortolândia, CF01, UF `sp` → criado como **CF30 / SP**.
4. Auditoria → mostra o LOGIN e o CREATE de `plants`.
5. Celular (375 px) → menu recolhido no botão ☰ e sem rolagem horizontal.

## Cenários de aceitação da especificação

| # | Cenário | Etapa |
| --- | --- | --- |
| 1 | Cadastrar material e consultá-lo no MM | 3 |
| 2 | Criar requisição, aprovar e converter em pedido | 3 |
| 3 | Receber parcialmente e conferir o estoque | 3 |
| 4 | Pedido de venda com verificação de disponibilidade | 4 |
| 5 | Confirmar pedido e reservar estoque | 4/5 |
| 6 | Entrega parcial com saída | 4/5 |
| 7 | Estoque MM atualizado após saída SD | 5 |
| 8 | Faturar e gerar título a receber | 4 |
| 9 | Registrar pagamento e quitar título | 4 |
| 10 | Trilha de documentos da compra à venda | 5 |
| 11 | Operação sem permissão → acesso negado | ✅ Etapa 1 (base) + Etapa 2 (MM/SD) |
| 12 | Centro fora do escopo → acesso negado | 2 |
| 13 | Todo movimento de estoque com documento e responsável | 3/5 |
| 14 | Evento recebido pelo n8n | 6 |
| 15 | IA consulta dados e mostra a fonte | 6 |
