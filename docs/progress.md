# Progresso, decisões e pendências

Atualizado a cada etapa. Serve para continuar o projeto em uma nova conversa sem perder o contexto.

## Estado atual: Etapa 2 concluída (19/11/2026)

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

**Etapa 3: MM** (próxima). Antes de codificar, apresentar os requisitos, o fluxo, as entidades, as telas e os critérios de aceitação. Confirmar as ambiguidades A2 (impostos), A3 (excesso no recebimento), A5 (moeda), A6 (aprovação por valor), A7 (MRP) e A8 (numeração) em [requirements.md](requirements.md).

Ordem proposta:
1. `document_sequences` e numeração.
2. Materiais e dados por centro.
3. Fornecedores.
4. Saldo e movimentos de estoque, com `FOR UPDATE` e teste de concorrência.
5. Requisição → aprovação → pedido.
6. Recebimento total ou parcial.
7. MRP simplificado.

Os testes de rota do cenário 11 (vendedor tentando criar pedido de compra etc.) entram junto com cada rota.

Pendências menores:
- Os checkboxes de roles e escopo têm o rótulo certo na tela, mas os leitores de tela anunciam só "on". Melhorar na Etapa 8 (acessibilidade).
