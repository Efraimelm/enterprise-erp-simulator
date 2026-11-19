# Progresso, decisões e pendências

Atualizado a cada etapa. Serve para continuar o projeto em uma nova conversa sem perder o contexto.

## Estado atual: Etapa 5 concluída (19/11/2026)

### Etapa 5: Integração MM + SD (implementado)
- Desenho em [integration-design.md](integration-design.md).
- **Trilha de documentos** (`/api/flow`) montada por consulta às chaves existentes, sem tabela nova. A ligação recebimento → saída é feita por **FIFO simulado**, que também atravessa as transferências 311.
- A trilha respeita permissão e escopo: documentos ocultos são contados e a trilha não passa por eles. O limite é de 150 documentos.
- **Busca global** pelo número na barra superior e tela **Fluxo de documentos** com 4 colunas (Compras, Estoque, Vendas, Financeiro). O botão "Ver trilha completa" aparece em RC, PC, pedido de venda, entrega e fatura.
- **Teste integrado** do ciclo completo (11 testes, 151 no total). Cenário 10 coberto.
- Teste manual: busca do pagamento → trilha até a requisição, com a saída atribuída a 60 da carga inicial + 20 da compra.

### Decisões da Etapa 5
Ver D28 a D31 em [integration-design.md](integration-design.md): trilha por consulta e sem `document_links`, FIFO simulado (não é lote nem custeio), permissão e escopo por nó, e limite de 150 documentos.

### Etapa 4: SD (implementado)
- Desenho em [sd-design.md](sd-design.md), escrito antes do código. As decisões A4, A6 (SD), A10 e A11 estão aplicadas.
- Migration `006_sd`, com 12 tabelas, e seed: 3 clientes com áreas de vendas, preços gerais e de atacado, preço especial por cliente e 2 descontos.
- **Preço por registros de condição** (cliente > canal > geral) e **desconto mais específico**, com validade. Preço, origem, desconto e imposto ficam gravados no item.
- **ATP simplificado** (consulta) e **reserva na confirmação**, com trava do saldo. Atendimento parcial opcional e reconfirmação.
- Aprovação acima de R$ 5.000 por outra pessoa. Cancelamento libera a reserva.
- **Entrega → separação → saída 601**: o serviço de estoque do MM ganhou o movimento 601, que baixa o físico e o reservado juntos.
- **Faturamento pela entrega** com título a receber (vencimento pela condição de pagamento). **Estorno** por documento negativo. Pagamento simulado parcial ou total, e títulos atrasados.
- 6 telas novas (Clientes, Condições comerciais com simulador de preço, Pedidos de venda com ATP, Entregas, Faturamento, Contas a receber), fluxo de documentos no pedido e indicadores de vendas no painel.
- 28 testes novos (140 no total), inclusive de concorrência na reserva e da regra **reservado = confirmado − entregue**. Teste manual do ciclo completo no navegador com 3 perfis.

### Decisões da Etapa 4
| # | Decisão | Motivo |
| --- | --- | --- |
| D22 | Reserva em `stock_balances.reserved_qty`, sem tabela de reservas | Um só lugar para o disponível. A coerência é garantida por teste |
| D23 | A saída 601 consome a reserva dentro do serviço de estoque | A mesma trava, documento e regra do MM. O SD não mexe no saldo direto |
| D24 | Status do pedido recalculado pelas quantidades | Evita status divergente das quantidades reais |
| D25 | Preço gravado no item (foto do momento) | Mudar uma condição depois não altera pedidos nem faturas já emitidos, como no SAP |
| D26 | Uma fatura por entrega. Estorno bloqueado se houver pagamento | Regra simples e auditável. O estorno de pagamento fica fora da v1 |
| D27 | O backend não sobe com migration pendente | Evita rodar código novo em banco antigo. Visto na prática no teste manual |

### Etapa 3: MM (implementado)
- Desenho em [mm-design.md](mm-design.md), escrito antes do código.
- Migration `005_mm`, com 17 tabelas, e seed de demonstração: 6 materiais em 2 centros, 3 fornecedores com registros info, códigos de imposto, condições de pagamento e estoque inicial lançado pelo **documento 561**.
- **Serviço de estoque único** (`stock-service.js`): todo saldo muda por documento de material.
  - Trava a linha com `FOR UPDATE`, sempre em ordem fixa.
  - `CHECK` de saldo não negativo.
  - Repete automaticamente em caso de deadlock.
- Numeração em transação (`document_sequences`).
- Materiais (dados por centro, status, histórico), fornecedores (registros info, histórico de compras), estoque (saldos, movimentos, documento de material, movimentos manuais 561/201/311, inventário 701/702).
- Requisição → aprovação → pedido, com:
  - aprovação automática até o limite e manual acima dele;
  - separação de funções;
  - envio simulado;
  - cancelamento que devolve a requisição;
  - recebimento parcial com tolerância de excesso.
- MRP simplificado com aprovação humana: as sugestões viram requisições de origem MRP.
- 7 telas novas e indicadores de compras no painel.
- 34 testes novos (112 no total), inclusive de **concorrência** e da regra **saldo = soma dos movimentos**. Teste manual do ciclo completo no navegador com 4 perfis.

### Decisões da Etapa 3
| # | Decisão | Motivo |
| --- | --- | --- |
| D16 | Um único serviço altera o estoque. Os outros módulos só chamam `postMaterialDocument` | Garante documento, trava e regra de saldo em um só lugar. O SD vai reutilizar |
| D17 | Os itens do recebimento são as próprias linhas de `stock_movements` | Evita duplicar dados (a especificação pede para não duplicar) |
| D18 | Documento de pedido só é editado em rascunho. Rejeição volta para rascunho | Ciclo simples e auditável |
| D19 | O MRP considera pedidos em qualquer status aberto, inclusive rascunho | Evita sugerir de novo o que já está sendo comprado |
| D20 | Inventário em um passo (contagem e lançamento) | Simplificação didática. O SAP separa em MI01/MI04/MI07 |
| D21 | Material e fornecedor são globais. Dados por centro e documentos seguem o escopo do centro | Igual à separação entre dados gerais e dados de centro do SAP |

### Etapa 2: Segurança (implementado)
- Migration `004_org_scopes`: escopo por usuário (`ALL`, `COMPANY` ou `PLANT`) e roles de sistema (`is_system`).
- Catálogo com 41 permissões (ADMIN, MM e SD) e 9 roles de sistema, com separação de funções. Ver [authorization.md](authorization.md).
- O escopo é aplicado em toda a estrutura organizacional:
  - as listas vêm filtradas;
  - abrir ou alterar um registro fora do escopo responde 403 `OUT_OF_SCOPE`, com registro na auditoria.
- API e telas de **Usuários**:
  - criar com senha provisória, que aparece uma vez;
  - editar, bloquear, inativar e reativar, sempre com motivo;
  - redefinir a senha;
  - definir roles e escopo.
- API e telas de **Roles e permissões**:
  - matriz de permissões por módulo;
  - roles personalizadas `Z_` (criar, alterar e excluir).
- Proteções:
  - ninguém altera a si mesmo;
  - ninguém concede o que não tem;
  - o sistema sempre mantém um SAP_ADMIN ativo;
  - bloquear ou redefinir a senha derruba as sessões.
- 40 testes novos (total de 78, todos aprovados) e teste manual no navegador.

### Decisões da Etapa 2
| # | Decisão | Motivo |
| --- | --- | --- |
| D11 | Escopo por **centro**, com a opção de empresa inteira ou ALL (ambiguidade A1 confirmada) | O centro é onde o estoque e os documentos de MM/SD existem |
| D12 | Roles de sistema somente leitura, sincronizadas pelo seed. Roles próprias com o prefixo `Z_` | Evita divergência entre ambientes e segue a convenção SAP |
| D13 | Permissões de MM/SD criadas já na Etapa 2 | As roles ficam completas e as próximas etapas só ligam as rotas |
| D14 | Senha provisória gerada pelo sistema e mostrada uma vez | O administrador nunca escolhe nem guarda a senha de outra pessoa |
| D15 | A gestão de usuários é global (não depende de escopo), mas a concessão de escopo é limitada ao escopo de quem concede | Simples e sem escalada de privilégio |

## Etapa 1: Fundação (implementado)
- Banco MariaDB portátil com scripts de setup, start e stop. Bancos `erp_dev` e `erp_test`.
- 3 migrations: segurança (usuários, roles, permissões, sessões, auditoria), estrutura organizacional (10 tabelas) e parâmetros.
- Seeds idempotentes: 7 permissões, 2 roles, usuários admin e auditor e a empresa Comércio Forte Ltda.
- API: login, logout, `/me`, troca de senha, CRUD genérico da estrutura organizacional, parâmetros e auditoria.
- Segurança:
  - Argon2id
  - sessão em cookie HttpOnly com o token guardado só como hash
  - CSRF
  - rate limit e bloqueio por tentativas
  - senha provisória obrigatória
  - permissões no backend
  - auditoria na mesma transação
- Frontend:
  - login e troca de senha
  - layout com menu por módulos (mostra o que é planejado)
  - painel com contadores e roadmap
  - estrutura organizacional (10 cadastros)
  - parâmetros
  - auditoria
  - responsivo
- 38 testes automatizados, todos aprovados. Teste manual no navegador feito.

### Simulado (por definição do projeto)
- Toda a estrutura organizacional é fictícia. Os conceitos seguem o SAP S/4HANA, mas sem nenhuma integração SAP.


## Decisões técnicas

| # | Decisão | Motivo |
| --- | --- | --- |
| D1 | Monólito modular (um backend, um banco) | Transações reais entre MM e SD. Simples de rodar e de explicar |
| D2 | MariaDB 11.4 portátil em vez do MySQL instalado | PC sem administrador. Compatível com MySQL (driver `mysql2`) |
| D3 | Knex em vez de ORM | SQL visível e didático, migrations e transações simples |
| D4 | Sessão em cookie com token aleatório (hash no banco) em vez de JWT | Revogável. Protegido de XSS |
| D5 | Proteção CSRF por SameSite=Strict + cabeçalho próprio + Origin | Sem token CSRF extra para gerenciar no frontend |
| D6 | Cadastros da estrutura definidos em `entities.js` e servidos por `/api/org/meta` | Uma única fonte de regras para o backend e o frontend. Menos código repetido |
| D7 | Inativar em vez de excluir. Exclusão só sem vínculos (FK RESTRICT) | Preserva o histórico e a integridade |
| D8 | Auditoria gravada na transação da operação | Não existe alteração sem registro |
| D9 | Projeto em `C:\dev`, fora do OneDrive | Desempenho e sem conflitos de sincronização |
| D10 | Testes num banco separado, recriado a cada execução | Testes repetíveis e sem afetar os dados de desenvolvimento |

## Pendências e próximos passos

**Etapa 6: n8n e IA** (próxima). Antes de codificar, escrever `docs/integration-api-design.md`. Decisão a confirmar: A9 (a IA respeita as permissões de quem pergunta). Proposta:
1. **API de integração:** clientes de integração com chave própria (guardada só como hash) e permissões restritas, só leitura no início. Paginação, filtros e idempotência nas operações de escrita futuras. **Documentação OpenAPI/Swagger** em `/api/docs`.
2. **Webhooks** com assinatura HMAC, nova tentativa com espera crescente e log em `integration_logs`, para os eventos `stock.below_reorder_point`, `purchase_requisition.created`, `purchase_order.approved`, `goods_receipt.posted`, `sales_order.created`, `sales_order.confirmed`, `delivery.posted` e `billing.created`.
3. **n8n:** novos fluxos no projeto Copiloto que recebem os eventos e geram alertas e resumo diário, trocando a Northwind pela API própria do ERP (sem chamá-la de "OData SAP").
4. **Assistente de IA**, só de consulta: ferramentas que chamam a API com a identidade do usuário, citam a fonte e o documento e usam cálculo determinista. Cenários 14 e 15.

Pendências menores:
- O redirecionamento para o login, visto uma vez no teste manual, veio de um logout feito por script durante a navegação. Não se repetiu.
- Os checkboxes de roles e escopo têm o rótulo certo na tela, mas os leitores de tela anunciam só "on". Melhorar na Etapa 8 (acessibilidade).
