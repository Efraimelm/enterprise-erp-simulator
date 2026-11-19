# Casos de teste

Rodar: `npm test`. Os testes recriam o banco `erp_test` do zero e nunca tocam no `erp_dev`.

## Resultado atual (19/11/2026): **78 testes, 78 aprovados**

| Arquivo | Testes | Etapa |
| --- | --- | --- |
| `auth.test.js` | 16 | 1 |
| `org.test.js` | 16 | 1 |
| `settings-audit.test.js` | 6 | 1 |
| `scope.test.js` | 14 | 2 |
| `admin.test.js` | 26 | 2 |

## Etapa 2

### `backend/tests/scope.test.js` (14): escopo organizacional
| Caso | Esperado |
| --- | --- |
| `/me` | Mostra o escopo ("Centro CF10 – Matriz São Paulo") |
| Usuário do CF10 lista centros, depósitos e empresas | Vê só o CF10, os depósitos do CF10 e a empresa CF01 |
| Usuário do CF10 abre o CF20 | 403 `OUT_OF_SCOPE` + auditoria DENIED "fora do escopo" |
| Registro inexistente | Continua 404 |
| Escopo de empresa | Vê todos os centros da CF01 e nada da outra empresa |
| Sem escopo | Nenhuma empresa ou centro. Cadastros globais visíveis |
| Áreas de vendas | Seguem a empresa da organização de vendas |
| Criar depósito | Permitido no CF10, 403 no CF20 |
| Mover depósito para o CF20 | 403 (confere o antes e o depois) |
| Alterar/excluir depósito do CF20 | 403 |
| Criar centro | Escopo de centro → 403. Escopo de empresa → 201 |
| Criar empresa | Exige o escopo ALL |
| Cadastro global | Não depende de escopo |
| Auditoria | A negação registra a operação (DELETE) |

### `backend/tests/admin.test.js` (26): usuários, roles e permissões
| Caso | Esperado |
| --- | --- |
| Matriz: vendedor × pedido de compra | SALES não tem `MM.PURCHASE_ORDER.CREATE` |
| Matriz: almoxarife × cliente | WAREHOUSE não tem `SD.CUSTOMER.UPDATE` |
| Matriz: analistas e comprador | Nenhuma permissão `.APPROVE` |
| Matriz: gestores | Aprovam no seu módulo |
| Matriz: auditor | Só `.READ` |
| Roles no banco | As 9 roles de sistema com as permissões exatas do seed |
| Criar usuário | 201 + senha provisória uma vez. O login exige a troca. A senha não aparece na auditoria |
| Validações | Usuário inválido → 400, duplicado → 409, role inexistente → 400 |
| Filtros | Por role e status |
| Bloquear / reativar | Sessão derrubada, login negado (403). Depois do reativar, login ok. Auditoria STATUS |
| Status sem motivo | 400 |
| Redefinir senha | Nova senha provisória, desbloqueio e sessões derrubadas |
| Alterar a si mesmo | `SELF_CHANGE` para status, roles e escopo |
| Último SAP_ADMIN | Bloquear o último → 409. A transação é desfeita |
| Escalada por role | Gestor de usuários tentando dar SAP_ADMIN → 403 `PRIVILEGE_ESCALATION` |
| Escalada por escopo | Admin de centro não dá ALL nem outro centro (403). O próprio centro é permitido |
| ALL substitui | `[PLANT, ALL]` vira `[ALL]` |
| Centro inexistente no escopo | 400 |
| Role Z_: criar, alterar, excluir | 201 / 200 / 204 + auditoria com as permissões incluídas |
| Código sem `Z_` | 400 |
| Role de sistema | Alterar → 403 `SYSTEM_ROLE`, excluir → 403 |
| Role em uso | Excluir → 409 |
| Auditor na administração | Consulta (200). Cria usuário ou role → 403 |
| Vendedor | Sem acesso à administração (403) |
| Almoxarife | Não altera parâmetros (403) |
| Troca da própria senha | Continua funcionando para qualquer role |

### Teste manual no navegador (Etapa 2)
1. Admin → **Usuários** → **Novo usuário** `comprador.cf10`, role PROCUREMENT, escopo Centro CF10 → senha provisória exibida uma vez.
2. Login como `comprador.cf10` → tela de troca de senha → troca feita.
3. **Estrutura organizacional → Centros**: só o CF10, sem os botões Novo/Editar/Excluir (só tem leitura). Menu sem Usuários, Roles e Auditoria.
4. Abrir o CF20 pela API → 403.
5. **Roles e permissões**: 9 roles de sistema com a matriz de permissões por módulo.

## Etapa 1: 38 testes

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
| 11 | Operação sem permissão → acesso negado | ✅ Etapas 1 e 2 (as rotas de MM/SD ganham o mesmo teste nas Etapas 3 e 4) |
| 12 | Centro fora do escopo → acesso negado | ✅ Etapa 2 |
| 13 | Todo movimento de estoque com documento e responsável | 3/5 |
| 14 | Evento recebido pelo n8n | 6 |
| 15 | IA consulta dados e mostra a fonte | 6 |
