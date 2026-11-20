# Power BI: painel do Enterprise ERP Simulator

Painel de BI que lê o ERP **pela API própria** (`/api/reports`), com uma chave **somente leitura**. Não acessa o banco diretamente, então as permissões, o escopo por centro e o log de acesso continuam valendo.

> Não há arquivo `.pbix` no repositório: ele é binário e só é montado no Power BI Desktop. Com os arquivos desta pasta, o painel é recriado em cerca de 15 minutos.

| Arquivo | Conteúdo |
| --- | --- |
| `powerquery/00-ErpRelatorio.pq` | Função M que chama `GET /api/reports/<nome>?all=true` com a chave no cabeçalho |
| `powerquery/10-tabelas.pq` | As 8 consultas do modelo (Estoque, Giro, Compras, ComprasPendentes, Vendas, VendasEmAberto, ContasAReceber, Calendario), já com tipos |
| `medidas.dax` | Medidas DAX com as **mesmas fórmulas** da API (ver `docs/bi-design.md`) |

## Passo a passo (Power BI Desktop, Windows)

1. **Chave de API no ERP:** Administração → Integrações → **Novo cliente**:
   - nome "Power BI";
   - role INTEGRATION_READONLY;
   - escopo: os centros que o painel deve mostrar.
   Copie a chave. Ela aparece uma única vez.
2. **Parâmetros** (Página Inicial → Transformar dados → Gerenciar parâmetros → Novo):
   - `ErpBase` (Texto) = `http://localhost:3001/api`
   - `ErpChave` (Texto) = a chave copiada
3. **Função:** Nova fonte → Consulta nula → Editor avançado → cole `00-ErpRelatorio.pq` → nomeie a consulta como **ErpRelatorio**.
4. **Tabelas:** para cada bloco de `10-tabelas.pq`, crie uma Consulta nula com o nome indicado no comentário e cole o bloco.
5. **Credencial:** se o Power BI pedir, escolha **Anônimo** para `http://localhost:3001`. A chave vai no cabeçalho `Authorization`.
6. **Fechar e aplicar.** Em Modelo, relacione `Vendas[periodo]` → `Calendario[Data]`.
7. **Medidas:** crie a tabela "Medidas" e adicione as medidas de `medidas.dax`.

## Páginas sugeridas
| Página | Visuais |
| --- | --- |
| **Visão geral** | Cartões: Valor do estoque, Materiais abaixo do ponto, Faturamento líquido, Total a receber, % vencido, Pontualidade de fornecedores |
| **Estoque** | Barras: valor por categoria. Tabela: materiais abaixo do ponto (filtro `abaixo_do_ponto`). Dispersão: giro × cobertura |
| **Compras** | Barras: valor comprado por fornecedor. Medidor: pontualidade. Tabela de pedidos atrasados |
| **Vendas** | Linha: faturamento líquido por mês (Calendario). Rosca: participação por categoria. Tabela de pedidos a entregar |
| **Financeiro** | Colunas empilhadas: a vencer, 1–30, 31–60, 61–90, > 90 por cliente |

## Observações
- **Atualização agendada no Power BI Service:** como a API está em `localhost`, é preciso um gateway pessoal. No portfólio, a atualização manual no Desktop basta.
- **O que é simulado:** o valor do estoque é pelo **preço de referência** (não há custo contábil), e contas a receber não tem integração bancária. O painel mostra isso no rodapé de cada página.
- Os mesmos números aparecem na tela **Relatórios** do ERP, que exporta CSV, e no resumo diário do n8n (`/api/kpis/summary`).
