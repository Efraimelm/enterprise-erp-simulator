# Como apresentar o projeto

Guia para falar do Enterprise ERP Simulator em entrevistas de consultoria SAP (MM/SD), estágio ou trainee, e no LinkedIn. A regra de ouro é ser preciso: dizer o que está **implementado**, o que é **simulado** e o que é **planejado**.

## Em 30 segundos
> "Construí do zero um ERP web inspirado nos conceitos do SAP S/4HANA, com os ciclos de compras (MM) e vendas (SD) completos: da requisição ao pagamento do cliente. Ele tem controle de acesso por role e por centro, aprovações, auditoria e trilha de documentos. Também integra com o n8n por API e webhooks, tem um assistente de IA que só consulta e relatórios com Power BI. São 195 testes automatizados. Não é SAP: é um simulador que eu fiz para entender os processos por dentro."

## Em 2 minutos (estrutura)
1. **Problema:** eu queria entender o *porquê* das regras de um ERP, e não só decorar transações.
2. **Escopo:**
   - estrutura organizacional (empresa, centro, depósito, organização de compras, área de vendas);
   - MM: requisição, pedido, recebimento, estoque e MRP;
   - SD: pedido com ATP e reserva, entrega, faturamento e contas a receber.
3. **Decisões de que me orgulho:**
   - O estoque só muda por documento de material, com movimentos 101, 201, 311, 561, 601, 701 e 702.
   - A auditoria fica na mesma transação da alteração.
   - Há segregação de funções: quem cria não aprova.
   - A trilha de documentos liga a compra à venda pelo FIFO simulado.
4. **Integração:**
   - API com chave somente leitura;
   - webhooks com assinatura HMAC e novas tentativas;
   - o n8n real recebeu os eventos nos testes;
   - IA com as permissões do usuário e sempre citando a fonte.
5. **Qualidade:** 195 testes automatizados, os cenários de aceitação da especificação e decisões documentadas (D1 a D45).

## Implementado, simulado e planejado
| | O que é |
| --- | --- |
| **Implementado** (funciona e tem teste) | Login com sessão segura, roles e 48 permissões, escopo por empresa e centro, aprovações, auditoria. MM completo (cadastros, estoque por documento, inventário, MRP simplificado). SD completo (condições de preço, ATP e reserva, entrega, saída 601, fatura, estorno, título e pagamento). Trilha de documentos, API de integração, webhooks, assistente de consulta, 7 relatórios e CSV |
| **Simulado** (de propósito) | Impostos (alíquota fixa por código, sem regra fiscal real). Contas a receber (sem banco nem contabilidade). Avaliação do estoque (preço de referência, sem custeio). Ligação compra ↔ venda (FIFO calculado, sem lote). Histórico da demonstração (criado pela API, com as datas movidas para o passado) |
| **Planejado / fora do escopo** | FI/CO (contabilização, centro de custo), lote e número de série, transporte, chaves de API com escrita, painel `.pbix` pronto |

## Ponte com os conceitos SAP (para estudo)
| No simulador | Conceito equivalente no SAP S/4HANA |
| --- | --- |
| Empresa / centro / depósito | Company code / plant / storage location |
| Organização de compras, grupo de compradores | Purchasing organization, purchasing group |
| Área de vendas (org. de vendas + canal + setor) | Sales area |
| Requisição → pedido → recebimento 101 | Ciclo P2P (purchase requisition, purchase order, goods receipt) |
| Pedido de venda → entrega → saída 601 → fatura | Ciclo O2C (sales order, outbound delivery, post goods issue, billing) |
| Condições de preço e desconto | Condition technique (bem simplificada) |
| ATP e reserva | Availability check |
| Trilha de documentos | Document flow |
| Roles com objetos e ações | Conceito de autorização por role (bem simplificado) |

> Use a tabela para mostrar que você conhece os conceitos, sem dizer que o simulador faz o mesmo que o SAP.

## Perguntas prováveis
| Pergunta | Resposta curta |
| --- | --- |
| "Por que não usou o SAP de verdade?" | "Eu não tenho acesso a um sistema SAP. Construir obrigou a entender cada regra: por que reservar, por que o estoque só muda por documento, por que separar quem cria de quem aprova" |
| "Como garante que o estoque não fica errado?" | "Existe um único serviço que grava saldos, sempre por documento de material e dentro de uma transação com bloqueio de linha. O saldo nunca é editado direto, e há testes de concorrência e de saldo insuficiente" |
| "E a segurança?" | "Senha com Argon2id, sessão em cookie httpOnly, proteção CSRF, limite de tentativas, permissão e escopo conferidos no backend em todas as rotas, e auditoria na mesma transação" |
| "Como a IA não inventa?" | "Ela só usa ferramentas de consulta que rodam com as permissões de quem pergunta. As fontes são montadas pelo backend, não pelo modelo, e sem chave há um modo determinista" |
| "O que você faria diferente?" | "Começaria pelos relatórios antes, para desenhar melhor as datas dos documentos. Os testes de BI acharam um erro de agrupamento que só aparecia com duas categorias no mesmo mês, e a trilha precisou de uma regra de linhagem para não puxar vendas que não tinham relação" |
| "Quanto tempo levou?" | Responda com a sua realidade, por etapas (8 etapas, cada uma testada antes da próxima) |

## Texto para o LinkedIn (edite com a sua voz)
> Terminei um projeto de portfólio que me ensinou mais sobre ERP do que qualquer apostila: um **ERP web construído do zero**, inspirado nos conceitos do SAP S/4HANA (não é SAP, é um simulador próprio).
>
> O que ele faz:
> 🔹 **Compras (MM):** requisição → aprovação → pedido → recebimento, estoque por documento de material, inventário e MRP simplificado
> 🔹 **Vendas (SD):** condições de preço, verificação de disponibilidade com reserva, entrega, faturamento com estorno e contas a receber
> 🔹 **Trilha de documentos** do pagamento do cliente até o pedido de compra que abasteceu a venda
> 🔹 **Segurança:** roles, escopo por centro, segregação de funções e auditoria
> 🔹 **Integração:** API, webhooks assinados com n8n, assistente de IA que só consulta e cita a fonte, e relatórios para Power BI
> 🔹 **195 testes automatizados**
>
> O maior aprendizado foi entender o *porquê* das regras: por que o estoque só muda por documento, por que quem cria não aprova e por que a reserva existe.
>
> Código e documentação: github.com/Efraimelm/enterprise-erp-simulator
>
> #SAP #ERP #SAPMM #SAPSD #n8n #PowerBI #SistemasDeInformação

Anexe 2 ou 3 capturas de `docs/img/` (fluxo de documentos, relatórios e assistente) ou o vídeo 1 do [roteiro de demonstração](demo-script.md).
