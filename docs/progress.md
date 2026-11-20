# Progresso, decisões e pendências

Atualizado a cada etapa. Serve para continuar o projeto em uma nova conversa sem perder o contexto.

## Estado atual: Etapa 7 concluída (19/11/2026)

### Etapa 7: BI, relatórios e Power BI (implementado)
- Desenho e fórmulas em [bi-design.md](bi-design.md).
- **API `/api/reports`**: 7 relatórios calculados no backend.
  - Cada resposta traz a fórmula (`meta.definition`), os totais e o escopo aplicado.
  - Aceita sessão ou chave somente leitura, `all=true` e CSV para o Excel.
  - Estoque: posição e valor (simulado), e giro com cobertura.
  - Compras: por fornecedor, com recebido e pontualidade, e pedidos pendentes e atrasados.
  - Vendas: faturamento por período e categoria, e pedidos em aberto.
  - Financeiro: contas a receber por faixa de vencimento.
- **Tela Relatórios e BI**: filtros, indicadores, gráfico de barras sem biblioteca, tabela paginada e exportação CSV.
- **Pacote Power BI** em [analytics/](../analytics/):
  - função Power Query que lê a API com a chave;
  - 8 consultas tipadas;
  - medidas DAX com as mesmas fórmulas;
  - páginas sugeridas.

  Não há `.pbix`, que é binário. O painel é montado no Power BI Desktop pelo passo a passo.
- Testes: 13 novos, **195 no total**, todos aprovados. A tela foi testada no navegador.
- **Simulado**: valor do estoque pelo preço de referência (sem custeio) e contas a receber sem integração bancária.

### Decisões da Etapa 7
| # | Decisão | Motivo |
| --- | --- | --- |
| D39 | Relatórios calculados no backend, com a fórmula na resposta | O ERP, o n8n, a IA e o Power BI mostram o mesmo número, rastreável até a regra |
| D40 | Estoque avaliado pelo preço de referência | Não há custeio (FI/CO). Fica explícito que é uma avaliação simulada |
| D41 | Vendas pelo faturamento ativo (faturas estornadas saem) | Sem dupla contagem |
| D42 | Power BI pela API com chave somente leitura, sem acesso ao banco | Mantém permissões, escopo e log de acesso |

### Etapa 6: API, webhooks, n8n e IA (implementado)
- Desenho em [integration-api-design.md](integration-api-design.md). A9 decidida: a IA usa a sessão de quem pergunta.
- Migration `007_integration`: chaves de API, idempotência, outbox de eventos, entregas, logs e consultas à IA.
- **Clientes de integração** = usuários técnicos com role e escopo.
  - Chave `erp_<prefixo>_<segredo>`, guardada só como hash, revogável, com validade.
  - **Somente leitura**, com limite de 300 chamadas por minuto e log de cada chamada.
  - Nova role INTEGRATION_READONLY.
- **OpenAPI 3.1 + Swagger** em `/api/docs` (rotas de leitura, KPIs, trilha e webhooks).
- **Idempotency-Key** em qualquer POST: repetição devolve a resposta original, e outro corpo responde 409.
- **Eventos (outbox na transação)** para RC, PC aprovado, recebimento, pedido de venda criado e confirmado, saída, fatura e estoque abaixo do ponto (sem repetir o mesmo alerta por 12 h).
- **Webhooks** assinados com HMAC-SHA256 e timestamp, segredo cifrado com AES-256-GCM, novas tentativas em 1 min, 5 min, 30 min, 2 h e 6 h e depois DEAD, reenvio manual e teste (ping).
- **KPIs** consolidados com as fórmulas (`/api/kpis/summary`).
- **Assistente de IA** só de consulta, com 7 ferramentas:
  - aplica as permissões e o escopo de quem pergunta;
  - as fontes são montadas pelo backend;
  - Gemini é opcional, e sem ele (ou se falhar) responde no modo determinista;
  - responde em Fatos, Estimativas e Recomendações;
  - cada consulta fica registrada.
- Telas **Integrações** (clientes e chaves, webhooks, eventos e logs) e **Assistente**.
- Fluxos **n8n** em `integrations/n8n/` (eventos com assinatura conferida e resumo diário). **Testados no n8n local:** ping e evento real entregues com HTTP 200, requisição forjada recusada com 401.
- 31 testes novos (182 no total). Cenários 14 e 15 cobertos.

### Decisões da Etapa 6
| # | Decisão | Motivo |
| --- | --- | --- |
| D32 | Cliente de integração é um usuário técnico | Reaproveita permissões e escopo. O n8n vê exatamente o que a role e o escopo permitem |
| D33 | Chaves só de leitura nesta versão | Menor risco. Escrita entra quando houver um caso de uso real |
| D34 | Outbox na transação, com despachante assíncrono | O evento existe se, e só se, o documento foi confirmado. A entrega não trava a operação |
| D35 | Segredo do webhook cifrado (não em hash) | O ERP precisa reler o segredo para assinar. O hash só serve para conferir |
| D36 | Assistente dentro do ERP com a sessão do usuário, e fontes pelo backend | Cumpre A9 e impede citação inventada pelo modelo |
| D37 | Modo determinista como padrão sem chave de IA | A demo funciona sem custo nem dependência externa, e serve de plano B se o Gemini falhar |
| D38 | Assinatura no n8n com o nó Crypto (HMAC), não com o nó Code | O nó Code do n8n bloqueia o módulo `crypto` por padrão |

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

**Etapa 8: Portfólio** (próxima):
1. Revisão final: acessibilidade (rótulos dos checkboxes), mensagens de erro e telas em celular.
2. Roteiro de demonstração e dados de exemplo mais ricos (vendas e títulos em vários meses, para os relatórios e o Power BI).
3. Vídeos curtos, capturas de tela no README e texto para o LinkedIn.
4. Guia de "como apresentar o projeto" em entrevista: o que é implementado, simulado e planejado.

Pendências menores:
- Estornar pagamento (hoje, fatura paga não pode ser estornada).
- Chaves de API com escrita (hoje só leitura), quando houver um caso de uso no n8n.
- Gerar o `.env` com `WEBHOOK_SECRET_KEY` já foi incluído no `db-setup`. Instalações antigas precisam acrescentar a linha à mão (ver setup-windows).

Pendências menores:
- O redirecionamento para o login, visto uma vez no teste manual, veio de um logout feito por script durante a navegação. Não se repetiu.
- Os checkboxes de roles e escopo têm o rótulo certo na tela, mas os leitores de tela anunciam só "on". Melhorar na Etapa 8 (acessibilidade).
