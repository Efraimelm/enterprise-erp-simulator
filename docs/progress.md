# Progresso, decisões e pendências

Atualizado a cada etapa. Serve para continuar o projeto em uma nova conversa sem perder o contexto.

## Estado atual: Etapa 1 concluída (19/11/2026)

### Implementado
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

### Adiantado da Etapa 2 (base mínima para proteger a Etapa 1)
- As tabelas `roles`, `permissions`, `role_permissions` e `user_roles`, o middleware `requirePermission` e a consulta da auditoria.
- **Falta na Etapa 2:** as telas de usuários e roles, o escopo organizacional e o catálogo completo de roles e permissões.

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

**Etapa 2: Segurança** (próxima)
1. Telas de usuários: criar, editar, bloquear, desbloquear, inativar e redefinir a senha (gera senha provisória).
2. Telas de roles e permissões, e atribuição de roles a usuários.
3. `user_org_scopes`: escopo por centro e empresa, aplicado nas consultas.
4. Catálogo completo de roles (MM_MANAGER, MM_ANALYST, SD_MANAGER, SD_ANALYST, PROCUREMENT, SALES, WAREHOUSE) e das permissões de MM e SD.
5. Testes de autorização da especificação (vendedor criando pedido de compra, depósito alterando cliente, centro fora do escopo…).
6. Confirmar as ambiguidades A1 (escopo) em [requirements.md](requirements.md).

Depois: Etapa 3 (MM). Antes de codificar, apresentar os requisitos, o fluxo, as entidades, as telas e os critérios de aceitação. Confirmar A2, A3, A5, A6, A7 e A8.
