# Enterprise ERP Simulator

ERP web próprio, de portfólio e para estudo, que **simula** processos empresariais inspirados nos conceitos do **SAP S/4HANA** (MM — Materiais e SD — Vendas).

> **Aviso:** este projeto **não é software SAP**, não usa código, marcas ou APIs da SAP e não se conecta a nenhum SAP. Os nomes de conceitos (empresa, centro, depósito, área de vendas) são usados só para fins didáticos.

**Autor:** Efraim Lima · Sistemas de Informação (Unasp-HT) · objetivo de carreira: Consultor SAP
**Projeto relacionado:** [Copiloto de Operações SAP com n8n](https://github.com/Efraimelm/copiloto-sap-n8n). Ele se liga a este ERP pela API própria (Etapa 6).

## Situação atual

| Etapa | Conteúdo | Situação |
| --- | --- | --- |
| **1. Fundação** | Banco, backend, frontend, login, layout, estrutura organizacional, parâmetros e auditoria | ✅ **Concluída e testada** |
| **2. Segurança** | Usuários, roles e permissões (44), escopo por empresa/centro, proteções contra escalada de privilégio | ✅ **Concluída e testada** |
| **3. MM** | Materiais, fornecedores, estoque (101/201/311/561/701/702), requisição → pedido → recebimento, inventário e MRP simplificado | ✅ **Concluída e testada** |
| **4. SD** | Clientes, condições comerciais, pedido de venda com ATP e reserva, entrega com saída 601, faturamento com estorno e contas a receber (simulado) | ✅ **Concluída e testada** |
| **5. MM + SD** | Trilha de documentos de ponta a ponta (RC → … → pagamento) com FIFO simulado, busca global por número e teste integrado do ciclo completo | ✅ **Concluída e testada** |
| **6. n8n e IA** | API de integração com chave (só leitura) e OpenAPI/Swagger, idempotência, webhooks assinados com novas tentativas, fluxos n8n testados com o n8n real e assistente de IA só de consulta que cita a fonte | ✅ **Concluída e testada** |
| **7. BI** | 7 relatórios com a fórmula de cada indicador (estoque, giro, compras, pedidos pendentes, faturamento, contas a receber por vencimento), tela de Relatórios com gráfico e exportação CSV, e pacote Power BI (Power Query + DAX) lendo a API | ✅ **Concluída e testada** |
| 8. Portfólio | Testes finais, vídeos e apresentação | Próxima |

O que é **implementado**, **simulado** e **planejado** está detalhado em [docs/progress.md](docs/progress.md).

## Tecnologias

React 19 + Vite · Node.js 22+ + Express 5 · MariaDB 11.4 (compatível com MySQL) · Knex (migrations e seeds) · Zod (validação) · Argon2id (senhas) · Vitest + Supertest (testes)

## Como rodar no Windows

Pré-requisitos: [Node.js 22 ou superior](https://nodejs.org) e Git. O banco é baixado automaticamente, sem instalar nada e sem precisar de administrador.

```powershell
git clone https://github.com/Efraimelm/enterprise-erp-simulator.git C:\dev\enterprise-erp-simulator
cd C:\dev\enterprise-erp-simulator
npm install          # dependências do backend e do frontend
npm run db:setup     # baixa o MariaDB portátil, cria o .env com senhas aleatórias e os bancos
npm run migrate      # cria as tabelas
npm run seed         # dados iniciais: empresa fictícia, roles e usuários admin/auditor
npm run dev          # backend em :3001 e frontend em :5173
```

Abra **http://localhost:5173**, entre com o usuário `admin` e a senha do campo `SEED_ADMIN_PASSWORD` do arquivo `.env`. No primeiro acesso, o sistema pede para trocar a senha.

O passo a passo completo, com os erros comuns, está em [docs/setup-windows.md](docs/setup-windows.md).

| Comando | O que faz |
| --- | --- |
| `npm run db:start` / `npm run db:stop` | Liga e desliga o banco local |
| `npm test` | Roda os testes automatizados num banco separado (`erp_test`) |
| `npm run db:reset` | Apaga e recria o banco de desenvolvimento com os dados iniciais |

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [docs/requirements.md](docs/requirements.md) | Análise da especificação: requisitos, ambiguidades, riscos e decisões pendentes |
| [docs/architecture.md](docs/architecture.md) | Arquitetura, tecnologias escolhidas e por quê, segurança e estrutura de pastas |
| [docs/data-model.md](docs/data-model.md) | Modelo de dados atual e planejado |
| [docs/authorization.md](docs/authorization.md) | Roles, permissões, escopo organizacional e proteções |
| [docs/mm-design.md](docs/mm-design.md) | Módulo MM: processo, regras de negócio, numeração, estoque e MRP |
| [docs/sd-design.md](docs/sd-design.md) | Módulo SD: preço, ATP e reserva, entrega, faturamento, estorno e contas a receber |
| [docs/integration-design.md](docs/integration-design.md) | Integração MM + SD: trilha de documentos, FIFO simulado e busca global |
| [docs/integration-api-design.md](docs/integration-api-design.md) | API de integração, chaves, idempotência, webhooks, n8n e assistente de IA |
| [docs/bi-design.md](docs/bi-design.md) | Relatórios e BI: fórmulas de cada indicador e decisões |
| [analytics/](analytics/) | Pacote Power BI: consultas Power Query, medidas DAX e passo a passo |
| [integrations/n8n/](integrations/n8n/) | Fluxos n8n (eventos e resumo diário) e passo a passo |
| `/api/docs` | Documentação OpenAPI/Swagger da API (com o sistema rodando) |
| [docs/api-documentation.md](docs/api-documentation.md) | Endpoints da API |
| [docs/test-cases.md](docs/test-cases.md) | Casos de teste e cenários de aceitação |
| [docs/setup-windows.md](docs/setup-windows.md) | Instalação e execução no Windows |
| [docs/progress.md](docs/progress.md) | Decisões técnicas, o que foi concluído e as pendências |
