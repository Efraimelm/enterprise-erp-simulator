# Arquitetura

## Visão geral

```
 Navegador (React SPA)                      Backend (Node.js + Express)                 Banco
 ─────────────────────                      ─────────────────────────────               ─────
 http://localhost:5173  ── /api (proxy) ──► http://127.0.0.1:3001                       MariaDB 11.4
   páginas + componentes                       helmet · JSON · cookies                   (compatível MySQL)
   AuthContext (sessão)                        CSRF (cabeçalho + origem)                 erp_dev / erp_test
   modules.js (menu)                           loadSession → req.user                    via Knex + mysql2
                                               requirePermission('X.Y.Z')
                                               rotas por módulo ─► validação Zod ─► transação ─► auditoria

 Etapa 6:  n8n ◄── webhooks (eventos) ── backend ── API REST + chave de integração ──► n8n / Power BI / IA
```

Um **monólito modular**: um backend e um banco, com o código dividido por módulo (`auth`, `org`, `settings`, `audit` e, depois, `mm`, `sd`, `integration`). É mais simples de rodar e de entender do que microserviços, e o banco único permite transações reais entre MM e SD, que são o coração do projeto.

## Tecnologias e por quê

| Camada | Escolha | Por quê | Alternativa descartada |
| --- | --- | --- | --- |
| Frontend | React 19 + Vite + CSS próprio | Pedido na especificação. O Vite tem servidor de desenvolvimento rápido e proxy para a API | Next.js: SSR desnecessário para um ERP interno |
| Backend | Node.js + Express 5 | Pedido na especificação. O Express 5 trata erros de funções `async` sem boilerplate | NestJS: mais estrutura do que o projeto precisa agora |
| Banco | **MariaDB 11.4 LTS** portátil | 100% compatível com o protocolo e o SQL do MySQL usados aqui. Roda **sem instalar e sem administrador**, essencial num PC corporativo | MySQL Server: o instalador pede administrador |
| Acesso ao banco | Knex (query builder + migrations + seeds) | SQL explícito e didático, migrations versionadas e transações simples | ORM (Sequelize/Prisma): esconde o SQL que você quer aprender |
| Validação | Zod | Um schema valida e já normaliza (ex.: código em maiúsculas) | Validação manual |
| Senhas | Argon2id (`argon2`) | Recomendação atual do OWASP | bcrypt: aceitável, mas mais antigo |
| Sessão | Cookie `HttpOnly` + `SameSite=Strict` com token aleatório. O banco guarda só o **hash** do token | Dá para revogar a sessão (logout, bloqueio, troca de senha). O JavaScript da página não acessa o token | JWT no localStorage: vulnerável a XSS e não dá para revogar |
| Testes | Vitest + Supertest | Rápidos, testam a API de verdade contra um banco real de teste | — |

> **Troca de tecnologia em relação à especificação:** só o servidor de banco (MariaDB no lugar do MySQL Community) e só pelo motivo de instalação. O código usa o driver `mysql2` e SQL padrão do MySQL. Para usar MySQL 8, basta apontar o `.env` para ele.

## Segurança (o que já está implementado)

| Ameaça | Proteção |
| --- | --- |
| Senha vazada do banco | Argon2id (memória 19 MiB, 2 iterações) |
| Força bruta | Rate limit no login (10 tentativas a cada 15 min por IP) + bloqueio da conta por 15 min após 5 erros |
| Descobrir usuários pelo login | Mesma resposta e o mesmo tempo para usuário inexistente e senha errada |
| Roubo de sessão por XSS | Cookie `HttpOnly`. O React escapa todo o texto renderizado. `helmet` adiciona cabeçalhos de segurança |
| CSRF | `SameSite=Strict` + cabeçalho `X-ERP-Client` obrigatório em escrita + checagem de `Origin` |
| SQL injection | Knex com parâmetros (nunca concatenação). Colunas de ordenação vêm de uma lista permitida |
| Acesso sem permissão | `requirePermission` no backend em toda rota. A negação é registrada na auditoria |
| Acesso a outro centro/empresa | Escopo organizacional aplicado nas consultas e nas escritas (403 `OUT_OF_SCOPE`). Ver [authorization.md](authorization.md) |
| Escalada de privilégio | Ninguém concede role ou escopo além do que tem, nem altera a si mesmo. O sistema sempre mantém um SAP_ADMIN ativo |
| Senha provisória | `must_change_password` bloqueia tudo até a troca. A política exige 12 caracteres e 3 tipos de caractere |
| Segredos no Git | `.env` ignorado no Git. O setup gera senhas aleatórias. Logs e auditoria mascaram campos `password`, `token`, `secret` e `cookie` |

## Estrutura de pastas

```
enterprise-erp-simulator/
├── README.md
├── .env.example            modelo de configuração (sem segredos)
├── package.json            workspaces + scripts gerais (db:setup, dev, test…)
├── scripts/                PowerShell: db-setup, db-start, db-stop (MariaDB portátil)
├── database/
│   ├── migrations/         estrutura do banco, versionada (Knex)
│   └── seeders/            dados iniciais idempotentes
├── backend/
│   ├── src/
│   │   ├── server.js       sobe o servidor (confere banco e migrations antes)
│   │   ├── app.js          monta o Express (usado também pelos testes)
│   │   ├── config.js       lê e valida o .env
│   │   ├── db.js           conexão Knex
│   │   ├── lib/            senha, auditoria, logger, erros, validação
│   │   ├── middleware/     sessão/permissão, CSRF, tratamento de erros
│   │   ├── modules/        auth, org (+ scope-rules), settings, audit, admin (users, roles)  (depois: mm, sd, integration)
│   │   └── scripts/        migrate.js, seed.js
│   └── tests/              testes de API (Vitest + Supertest)
├── frontend/
│   └── src/
│       ├── api.js, auth.jsx, modules.js
│       ├── components/     Shell (layout), EntityPage (cadastro genérico)
│       └── pages/          Login, ChangePassword, Dashboard, OrgStructure, Settings, Audit, Users, Roles
├── docs/                   requisitos, arquitetura, modelo de dados, API, testes, progresso
└── .tools/                 (fora do Git) MariaDB portátil e dados locais
```

Pastas previstas na especificação que entram nas próximas etapas: `integrations/n8n/` (6), `analytics/` (7) e `screenshots/` (8).

## Padrões do código

- **Uma definição, dois usos:** `backend/src/modules/org/entities.js` define os campos de cada cadastro. Dela saem a validação, as rotas REST e o formulário da tela (via `GET /api/org/meta`).
- **Erros padronizados:** `{ "error": { "code", "message", "details": [{ "field", "message" }] } }`.
- **Inativar em vez de excluir:** a exclusão só é aceita se nada referenciar o registro. Se houver referência, a API responde 409 `IN_USE`.
- **Datas em UTC** no banco. A tela converte para o fuso do usuário.
