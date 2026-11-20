# Casos de teste

Rodar: `npm test`. Os testes recriam o banco `erp_test` do zero e nunca tocam no `erp_dev`.

## Resultado atual (19/11/2026): **182 testes, 182 aprovados**

| Arquivo | Testes | Etapa |
| --- | --- | --- |
| `auth.test.js` | 16 | 1 |
| `org.test.js` | 16 | 1 |
| `settings-audit.test.js` | 6 | 1 |
| `scope.test.js` | 14 | 2 |
| `admin.test.js` | 26 | 2 |
| `mm.test.js` | 34 | 3 |
| `sd.test.js` | 28 | 4 |
| `e2e.test.js` | 11 | 5 |
| `integration.test.js` | 31 | 6 |

## Etapa 6: `backend/tests/integration.test.js` (31)
| Grupo | Casos |
| --- | --- |
| Chave de API | Aparece uma vez, banco guarda só o hash. Lê com role e escopo (só CF10). KPIs com as fórmulas. POST → 403 `READ_ONLY_KEY`. Sem acesso à administração. Log de cada chamada. Usuário técnico não entra pela tela. Chave inexistente ou revogada → 401. Limite por chave → 429. Vendedor não administra integrações |
| Idempotência | Mesma `Idempotency-Key` → mesma resposta (`Idempotent-Replay`), um só movimento. Outro corpo → 409 `IDEMPOTENCY_CONFLICT`. Chave mal formada → 400 |
| **Cenário 14** (webhooks) | Segredo cifrado. Requisição → evento na transação → **receptor HTTP local recebe o POST e a assinatura HMAC confere** → entrega SUCCESS + log. Operação desfeita (ATP sem estoque) **não** gera evento. Alerta de estoque baixo emitido uma vez (sem repetir). Receptor com 503 → novas tentativas até DEAD (6 tentativas) → reenvio manual → SUCCESS. Filtro por evento. Tela de eventos. URL e evento inválidos → 400 |
| OpenAPI | Especificação 3.1 com rotas e webhooks. Swagger UI com CSP própria |
| **Cenário 15** (assistente) | Determinista com fonte montada pelo sistema. Custo de reposição = soma do MRP, em "Estimativas". **Vendedor não obtém pedidos de compra pela IA** (negado, sem fonte). Escopo: só pedidos do CF10. Pergunta fora do repertório → ajuda. "Crie uma requisição" não cria nada. **Gemini simulado:** chama a ferramenta e a fonte vem do backend, e o vendedor nem recebe as ferramentas de compras. Gemini falhando → modo determinista com aviso. Consulta registrada sem segredos. Sem permissão → 403. Capabilities por usuário |

### Teste real com o n8n local (Etapa 6)
1. Webhook cadastrado no ERP para `http://localhost:5678/webhook/erp-eventos`. Fluxo `10-erp-eventos.json` importado e publicado no n8n com o segredo (o arquivo do repositório guarda só o placeholder).
2. **Testar** (ping) → entrega **SUCCESS, HTTP 200, 1 tentativa**.
3. Requisição 1000000001 criada → evento `purchase_requisition.created` → **SUCCESS, HTTP 200** pelo despachante.
4. Requisição forjada (assinatura errada) direto no n8n → o próprio fluxo responde **401**.
5. Tela Integrações → Eventos mostra as duas entregas. Swagger em `/api/docs` com 26 operações (rotas + webhooks). Assistente responde o custo de reposição (R$ 9.307,30, 5 itens) com método e fonte.
6. Depois o banco de desenvolvimento foi recriado, o webhook recadastrado com um segredo novo e o fluxo atualizado no n8n. Ping final: SUCCESS 200.

## Etapa 5: `backend/tests/e2e.test.js` (11): ciclo completo e trilha
| Caso | Esperado |
| --- | --- |
| Compra | RC → aprovação → PC (aprovado automaticamente: 20 × 4 = 80) → dois recebimentos de 10 → pedido RECEIVED |
| Venda | Pedido de 15 → reserva → entrega → saída 601 → fatura → pagamento total. Estoque final: físico 5, reservado 0 |
| **Cenário 10** | A trilha a partir do **pagamento** contém pagamento, título, fatura, entrega, pedido de venda, saída 601, os 2 recebimentos, o PC e a **RC**, sem nada oculto |
| FIFO | A saída de 15 recebeu 10 do 1º recebimento e 5 do 2º |
| Sentido inverso | A trilha a partir da RC chega ao pagamento. As arestas seguem o processo (RC→PC→101, venda→entrega→601, título→pagamento) |
| Auditor | Vê a trilha inteira (leitura, todos os centros) |
| Vendedor | Vê vendas e estoque. PC, RC e fatura ficam ocultos e contados em `hidden` |
| Outro centro | 403 `OUT_OF_SCOPE` |
| Busca global | Encontra PC, documento de material, pedido de venda e fatura pelo número. Vendedor não encontra o PC, e usuário do CF20 não encontra a venda do CF10. Texto não numérico → 400 |
| Erros | Tipo desconhecido → 400. Documento inexistente → 404 |
| Transferência 311 | Venda pelo depósito 0002 rastreia carga 561 (0001) → transferência 311 → saída 601 |

### Teste manual no navegador (Etapa 5)
1. Ciclo criado pela API real no banco de desenvolvimento: RC 1000000001 → PC 4500000001 → recebimento 4900000002 (40 de café) → venda 0000000001 (80 de café para a Padaria) → entrega 8000000001 → saída 4900000003 → fatura 9000000001 → pagamento 1400000001.
2. Na barra superior, a busca por **1400000001** abriu a trilha do pagamento: 10 documentos em 4 colunas (Compras, Estoque, Vendas, Financeiro).
3. A saída 4900000003 mostra que veio **60 da carga inicial 4900000001 + 20 do recebimento 4900000002** (FIFO simulado), e a trilha continua até a RC.
4. Celular (375 px): colunas empilhadas, sem rolagem horizontal.

## Etapa 4: `backend/tests/sd.test.js` (28)
| Grupo | Casos |
| --- | --- |
| Preço e desconto | Preço do cliente > canal > geral. Desconto mais específico (8% da campanha do Atacadão em vez dos 3% do atacado). Validade invertida → 400 |
| Cenário 4 (pedido + ATP) | ATP mostra disponível 50, confirmável 50 e falta 30 sem reservar. Pedido com numeração 00…, preço geral e imposto padrão de 18% (200 + 36 = 236). Cliente fora da área de vendas e material sem preço → 400 |
| Cenário 5 (confirmar e reservar) | Até R$ 5.000 confirma direto e reserva 20 (disponível no MM cai para 30). Atendimento parcial confirma 30 de 40 e reconfirma depois da entrada de estoque. Sem parcial, falta de estoque → 409 sem reservar nada. **Concorrência:** dois pedidos de 8 sobre 10 em paralelo → um confirmado e um recusado, reservado 8. Acima do limite: criador e vendedor não aprovam, outro gestor aprova e só então reserva. Cancelar libera a reserva |
| Cenários 6 e 7 (entrega e saída) | Não entrega mais que o confirmado. Entrega parcial deixa o pedido "em entrega". Sem separação não lança saída. Saída 601: físico 50→38 e reservado 20→8, movimento 601 visível no MM. Separação menor que a entrega mantém a diferença reservada. Entrega não lançada pode ser excluída, a lançada não |
| Cenários 8 e 9 (fatura e título) | Fatura 90… com valores proporcionais (120 + 21,60 = 141,60). Título com vencimento em 30 dias. Pedido → BILLED. Fatura duplicada → 409. Pagamento parcial, excesso recusado e quitação |
| Estorno (A11) | Fatura com pagamento não é estornada. O analista não estorna (403). O gestor estorna: documento negativo, original e título cancelados, pedido volta para "entregue" e pode ser faturado de novo. Título vencido aparece como atrasado |
| Permissões e escopo | Almoxarife não cria pedido de venda nem altera cliente. Vendedor não cria entrega, fatura nem vê títulos. O vendedor do CF10 não vende pelo CF20, e a lista vem filtrada |
| Consistência | **Reservado = soma de (confirmado − entregue)** em todos os depósitos. **Físico = soma dos movimentos** (MM + SD) |

### Teste manual no navegador (Etapa 4)
1. `qa.vendas` (Vendedor, CF10) → **Pedidos de venda → Novo**: Atacadão, CF10/Atacado/Alimentos, arroz × 100 → **Verificar disponibilidade**: disponível 120, confirmável 100, falta 0.
2. Rascunho **0000000001**: preço do canal R$ 29,90 e desconto de 8% (campanha do cliente). Total R$ 2.990,00 − R$ 239,20 + 18% = **R$ 3.245,94**. **Confirmar** → abaixo de R$ 5.000 → confirmado com 100 reservados.
3. `qa.expedicao` (Almoxarife) → entrega **8000000001** com 60 → separação → saída lançada, documento de material **4900000002**. Estoque do arroz no MM: físico 60, reservado 40, disponível 20.
4. `qa.gestorsd` (Gestor SD) → fatura **9000000001**: 60 × 29,90 − 8% = R$ 1.650,48 + 18% = **R$ 1.947,57**. Título com vencimento em 60 dias (condição D60 do cliente).
5. Pagamento PIX **1400000001** → título quitado. O fluxo de documentos do pedido mostra pedido → entrega/saída → fatura → título pago.

## Etapa 3: `backend/tests/mm.test.js` (34)
| Grupo | Casos |
| --- | --- |
| Cenário 1 (material) | Criar, estender para o centro e consultar com estoque e histórico. Validação de unidade e preço. Código duplicado → 409. Material bloqueado fora de novos documentos. Registro info visível no material e no fornecedor |
| Cenário 2 (RC → PC) | Numeração 10…. Comprador e analista não aprovam (403). Gestor não aprova a própria RC (`SEGREGATION_OF_DUTIES`). Aprovar duas vezes → 409. Conversão com preço do registro info e imposto de 18% (645,00 + 116,10 = 761,10). Rejeição exige motivo e não converte |
| Pedido | Até R$ 1.000 → aprovado automaticamente. Acima → aguardando. Criador não aprova. Outro gestor aprova e envia. Rejeitar volta a rascunho. Só rascunho é alterado. Valida o depósito do centro e o fornecedor ativo. Cancelar devolve a RC para aprovada |
| Cenário 3 (recebimento) | Recebe 10 de 30: estoque +10, status parcial, documento 49…. Acima do pendente sem permissão → 400. Gestor dentro da tolerância de 5% → recebido. Recebido não recebe mais. Com recebimento não cancela. Rascunho não recebe |
| Estoque | Saída maior que o disponível → 409 `INSUFFICIENT_STOCK`, sem alterar nada. Transferência 311 em duas linhas. Movimento manual exige justificativa e MM.STOCK.ADJUST. Inventário com 701/702 deixa o saldo igual à contagem |
| Cenário 13 | Todo movimento tem documento, tipo, responsável e data. **O saldo de cada depósito é igual à soma dos movimentos** |
| Concorrência | 10 saídas de 3 em paralelo sobre 20 → exatamente 6 aprovadas, 4 recusadas, saldo 2. 8 lançamentos paralelos → 8 números de documento diferentes |
| MRP | Sugere 90 (máx. 100 − cobertura 10). Converte em RC de origem MRP. Rodar de novo não sugere outra vez (a RC aberta cobre). Acima do ponto não sugere. Comprador não roda o MRP |
| Cenários 11 e 12 | Vendedor não cria PC nem RC. Almoxarife não altera material nem fornecedor. Usuário do CF10 não cria RC no CF20 nem abre PC do CF20, e as listas vêm filtradas. Dados do material no CF20 ficam ocultos e bloqueados |

### Teste manual no navegador (Etapa 3)
1. `qa.compras` (Comprador, CF10) → **Requisições → Nova**: Feijão, 150 un. → RC **1000000001**, R$ 1.110,00 (preço do registro info, R$ 7,40).
2. `qa.gestor` (Gestor MM) → aprova → **Converter em pedido**: F0001, org. CF10, grupo 001, ICMS 18% → PC **4500000001** em rascunho, com R$ 1.110,00 + R$ 199,80 = R$ 1.309,80 e a RC ligada nos documentos relacionados.
3. **Enviar para aprovação** → acima do limite de R$ 1.000 → a tela mostra "Aguardando outro aprovador". O criador não vê o botão Aprovar.
4. `qa.gestor2` → **Aprovar** → "aprovado por qa.gestor2".
5. `qa.almox` (Almoxarife) → **Registrar recebimento** de 100 de 150 → documento **4900000002**, pedido PARTIALLY_RECEIVED.
6. **Estoque**: feijão no CF10 passou de 35 para 135. **Materiais → ALM-0002**: dados do centro só para leitura (o almoxarife não altera), estoque por depósito e registro info.

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
| 1 | Cadastrar material e consultá-lo no MM | ✅ Etapa 3 |
| 2 | Criar requisição, aprovar e converter em pedido | ✅ Etapa 3 |
| 3 | Receber parcialmente e conferir o estoque | ✅ Etapa 3 |
| 4 | Pedido de venda com verificação de disponibilidade | ✅ Etapa 4 |
| 5 | Confirmar pedido e reservar estoque | ✅ Etapa 4 (inclusive com concorrência) |
| 6 | Entrega parcial com saída | ✅ Etapa 4 |
| 7 | Estoque MM atualizado após saída SD | ✅ Etapa 4 (físico e reservado, movimento 601 visível no MM) |
| 8 | Faturar e gerar título a receber | ✅ Etapa 4 |
| 9 | Registrar pagamento e quitar título | ✅ Etapa 4 |
| 10 | Trilha de documentos da compra à venda | ✅ Etapa 5 |
| 11 | Operação sem permissão → acesso negado | ✅ Etapas 1 e 2 (as rotas de MM/SD ganham o mesmo teste nas Etapas 3 e 4) |
| 12 | Centro fora do escopo → acesso negado | ✅ Etapa 2 |
| 13 | Todo movimento de estoque com documento e responsável | ✅ Etapa 3 (MM). Saídas do SD na Etapa 5 |
| 14 | Evento recebido pelo n8n | ✅ Etapa 6 (teste automatizado + n8n real) |
| 15 | IA consulta dados e mostra a fonte | ✅ Etapa 6 |
