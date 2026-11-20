# Análise da especificação

Fonte: *Prompt Mestre — Enterprise ERP Simulator*. Este documento registra como a especificação foi entendida, o que ainda está ambíguo e os riscos do projeto.

## 1. Resumo do que será construído

Um ERP web próprio, multiusuário e modular, que simula:

| Módulo | Conceito SAP de referência | Escopo |
| --- | --- | --- |
| Administração | Enterprise Structure, autorizações (PFCG), auditoria | Empresas, centros, depósitos, organizações de vendas e compras, usuários, roles, permissões, escopo e auditoria |
| MM | Materials Management | Materiais, fornecedores, requisição, pedido, recebimento, estoque e MRP simplificado |
| SD | Sales and Distribution | Clientes, preços, pedido de venda, ATP simplificado, entrega, faturamento e título a receber |
| Integração | APIs e eventos | API REST própria (OpenAPI), webhooks e n8n |
| IA | Assistente de consulta | Consulta por ferramentas, sempre citando a fonte e respeitando as permissões |
| BI | Analytics | KPIs com fórmulas documentadas e alimentação do Power BI |

**Ideia central:** MM e SD compartilham o **mesmo cadastro de materiais e o mesmo saldo de estoque**. Toda mudança de saldo acontece por um **documento de movimento**, com responsável e data.

## 2. Requisitos não funcionais e como serão atendidos

| Requisito | Como |
| --- | --- |
| Autorização no backend | Middleware `requirePermission` em todas as rotas protegidas. O frontend só esconde botões, por conveniência |
| Integridade transacional | Transações do banco em toda operação que mexe em mais de uma tabela. No estoque, `SELECT … FOR UPDATE` (Etapa 3) |
| Auditoria | Tabela `audit_logs`, gravada na **mesma transação** da alteração |
| Rastreabilidade | Tabela de vínculos entre documentos (Etapa 5): RC → PC → entrada de mercadoria → … → fatura → título |
| Segredos fora do Git | `.env` ignorado no Git, `.env.example` sem valores reais e senhas geradas pelo script de setup |
| Testes | Vitest + Supertest num banco separado (`erp_test`), recriado a cada execução |
| Backup | `mariadb-dump` em script (Etapa 8) |

## 3. Ambiguidades e decisões que precisam do dono do produto

As propostas abaixo serão usadas se não houver outra orientação. Cada uma será confirmada antes da etapa em que entra.

| # | Ponto ambíguo | Proposta | Etapa |
| --- | --- | --- | --- |
| A1 | O escopo do usuário é por empresa, por centro ou por ambos? | ✅ **Decidido (19/11/2026):** por **centro**, com as opções de empresa inteira e ALL. Ver [authorization.md](authorization.md) | 2 |
| A2 | Como simular impostos? | ✅ **Decidido (Etapa 3):** tabela de **códigos de imposto** com percentuais configuráveis, aplicados por item. Sem regra fiscal real | 3/4 |
| A3 | Recebimento acima do pedido | ✅ **Decidido:** bloqueado por padrão. Tolerância percentual **por fornecedor**, só com a permissão `MM.GOODS_RECEIPT.OVERDELIVERY` | 3 |
| A4 | Faturamento baseado no pedido ou na entrega? | ✅ **Decidido (Etapa 4):** na **entrega** com saída lançada. Uma fatura por entrega, só com o que saiu do estoque | 4 |
| A5 | Moedas | ✅ **Decidido:** a moeda do documento é a da empresa do centro (BRL no demo). Sem conversão cambial | 3 |
| A6 | Regras de aprovação de pedidos | ✅ **Decidido (MM):** até o parâmetro `po_approval_limit` (R$ 1.000,00), aprovação automática. Acima, outra pessoa com `MM.PURCHASE_ORDER.APPROVE`. ✅ **SD:** até `so_approval_limit` (R$ 5.000,00) confirma direto. Acima, outra pessoa com `SD.SALES_ORDER.APPROVE` | 3/4 |
| A7 | MRP: horizonte e tamanho de lote | ✅ **Decidido:** cobertura = disponível + pedidos e requisições abertos. Repõe até o máximo. Sem datas nem lead time. Explicitamente **simplificado** | 3 |
| A8 | Numeração de documentos | ✅ **Decidido:** faixas em `document_sequences` (RC 10…, PC 45…, doc. material 49…, inventário 01…), geradas dentro da transação | 3 |
| A9 | Como a IA respeita as permissões de quem pergunta? | ✅ **Decidido (Etapa 6):** o assistente roda no ERP com a **sessão do próprio usuário**, e as ferramentas aplicam permissão e escopo. O modelo só recebe as ferramentas que a pessoa pode usar. (Proposta original:) O chat chama a API **com a sessão do próprio usuário**. O n8n usa uma chave de integração só de leitura e repassa a identidade do usuário. Detalhado na Etapa 6 | 6 |
| A10 | O pedido de venda reserva estoque na criação ou na confirmação? | ✅ **Decidido:** na **confirmação**, com trava do saldo. O rascunho só consulta a disponibilidade (ATP) | 4 |
| A11 | Cancelamento de fatura | ✅ **Decidido:** gera um **documento de estorno** com valores negativos, que referencia o original, e cancela o título. Fatura com pagamento não é estornada | 4 |

## 4. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Escopo grande para uma pessoa | Projeto não termina | Etapas pequenas e utilizáveis. Cada uma termina testada e documentada |
| Saldos errados em operações simultâneas | Estoque negativo ou reserva dupla | Transação + `FOR UPDATE` na linha de saldo, mais teste de concorrência com operações em paralelo |
| Confundir o simulador com SAP real | Problema ético e de credibilidade no portfólio | Aviso no README, no login e no painel. A API própria nunca é chamada de "OData SAP" |
| PC corporativo com restrições (sem administrador) | Ambiente não sobe | MariaDB portátil, sem instalador nem serviço do Windows |
| Pasta dentro do OneDrive | Lentidão e conflitos no `node_modules` | Projeto em `C:\dev`, fora do OneDrive |
| Cota gratuita do Gemini | IA indisponível na demonstração | Cálculos sempre deterministas no backend. A IA só conversa. Mensagem clara quando a cota acabar |
| Vazar segredos no GitHub | Contas comprometidas | `.gitignore`, `.env.example`, senhas aleatórias e revisão antes de cada push |

## 5. Critérios de aceitação

Os 15 cenários obrigatórios da especificação (seção 12) estão em [test-cases.md](test-cases.md), com a etapa em que cada um é coberto.
