# Modelo de autorização (Etapa 2)

O acesso depende de duas perguntas, sempre respondidas no **backend**:

1. **O que** o usuário pode fazer → **roles**, que reúnem **permissões** (ex.: `MM.PURCHASE_ORDER.CREATE`).
2. **Onde** ele pode fazer → **escopo organizacional** (empresas e centros).

> Paralelo com o SAP: as roles fazem o papel das roles do PFCG, e as permissões, dos objetos de autorização. O escopo lembra os valores de organização (ex.: `WERKS` para o centro). A implementação é própria e simplificada.

## Permissões (48)

Permissões acrescentadas na **Etapa 6**:
- `ADMIN.INTEGRATION.READ` e `ADMIN.INTEGRATION.MAINTAIN`: clientes, chaves, webhooks e logs.
- `AI.ASSISTANT.USE`: todas as roles de negócio. O que a IA mostra continua limitado às outras permissões.
- `BI.KPI.READ`: indicadores. Fica nas roles de negócio, exceto vendedor.

Nova role de sistema **INTEGRATION_READONLY**, para clientes como o n8n e o Power BI: leitura de MM, SD, estrutura e KPIs, sem escrita.


Permissões acrescentadas depois da Etapa 2:
- **Etapa 3:** `MM.GOODS_RECEIPT.OVERDELIVERY`, que permite receber acima do pedido dentro da tolerância do fornecedor. Está no MM_MANAGER e no SAP_ADMIN.
- **Etapa 4:** `SD.BILLING.READ` e `SD.RECEIVABLE.READ`. Estão no SD_MANAGER, SD_ANALYST, AUDITOR e SAP_ADMIN.

Formato `MÓDULO.OBJETO.AÇÃO`. A lista completa e a descrição de cada permissão estão em `database/seeders/01_permissions_roles.js`.

| Módulo | Objetos |
| --- | --- |
| ADMIN | ORG, SETTINGS, AUDIT, USER, ROLE |
| MM | MATERIAL, SUPPLIER, PURCHASE_REQ, PURCHASE_ORDER, GOODS_RECEIPT, STOCK, MRP |
| SD | CUSTOMER, PRICE, SALES_ORDER, DELIVERY, BILLING, PAYMENT |

As permissões de MM e SD já existem para as roles ficarem completas. As rotas que as exigem chegam nas Etapas 3 e 4.

## Roles de sistema

| Role | Para quem | Aprova? | Destaques |
| --- | --- | --- | --- |
| SAP_ADMIN | Administrador do sistema | Sim | Todas as permissões |
| MM_MANAGER | Gestor de materiais | Sim (MM) | Todo o MM, inclusive o ajuste de estoque |
| MM_ANALYST | Analista de materiais | Não | Materiais, fornecedores, requisições e MRP |
| PROCUREMENT | Comprador | Não | Fornecedores, requisições e pedidos de compra |
| WAREHOUSE | Almoxarife / expedição | Não | Recebimento, estoque e entrega |
| SD_MANAGER | Gestor de vendas | Sim (SD) | Todo o SD, inclusive os estornos |
| SD_ANALYST | Analista de vendas | Não | Clientes, pedidos, entregas e faturamento |
| SALES | Vendedor | Não | Clientes, preços, estoque e pedidos de venda |
| AUDITOR | Auditoria | — | Todas as permissões `.READ` |

**Separação de funções:** quem cria um documento não tem a permissão de aprová-lo. O teste `admin.test.js` garante isso para todas as roles.

As roles de sistema vêm do seed e ficam **somente leitura** na tela. Para outras combinações, crie uma **role personalizada**. O código começa com `Z_`, como na convenção do SAP para objetos do cliente.

## Escopo organizacional

| Tipo | Significa | Pode manter |
| --- | --- | --- |
| `ALL` | Todas as empresas e centros | Tudo, inclusive criar empresas |
| `COMPANY` | Uma empresa inteira, com todos os centros dela, inclusive os criados depois | Centros, organizações de vendas e compras e áreas de vendas da empresa |
| `PLANT` | Um centro | Depósitos e atribuições do centro. Vê a própria empresa, só para leitura |

- O escopo efetivo é a **união** das linhas do usuário. Sem escopo, o usuário só vê os cadastros globais (canais, setores e grupos de compradores).
- **Listas** já vêm filtradas. **Abrir, alterar ou excluir** um registro fora do escopo responde `403 OUT_OF_SCOPE` e registra a tentativa na auditoria. Um registro inexistente continua respondendo 404.
- **Alterar** confere o registro antes e depois da mudança. Exemplo: não dá para mover um depósito para um centro fora do seu escopo.
- As regras de cada cadastro estão em `backend/src/modules/org/scope-rules.js`. Nas Etapas 3 e 4, os documentos de MM e SD seguem a mesma lógica pelo centro de cada documento.

## Proteções da administração

| Regra | Por quê |
| --- | --- |
| Ninguém altera o próprio status, roles ou escopo | Evita autoconcessão e bloqueio acidental. Outro administrador faz a mudança |
| Ninguém concede permissão ou escopo que não possui (`PRIVILEGE_ESCALATION`) | Evita escalada de privilégio por meio de roles ou escopos |
| O sistema nunca fica sem um SAP_ADMIN ativo | Evita perder o acesso administrativo |
| Bloquear, inativar ou redefinir a senha encerra as sessões | O efeito é imediato |
| A senha provisória aparece uma única vez e não é gravada | O banco guarda só o hash Argon2id. O usuário troca no primeiro login |
| Alterar o status exige um motivo | O motivo vai para a auditoria |
| Mudanças de roles e escopo valem na próxima requisição | A sessão recarrega as permissões a cada chamada |
