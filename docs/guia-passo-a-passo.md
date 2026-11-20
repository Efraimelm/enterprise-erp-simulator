# Guia passo a passo do Enterprise ERP Simulator

Guia para quem vai usar o simulador pela primeira vez. Siga as partes na ordem. Cada uma diz **o que fazer**, **onde clicar** e **o que você deve ver**.

> O simulador é um projeto educacional, inspirado em conceitos do SAP S/4HANA. **Não é software SAP** e não se conecta a nenhum SAP.

## Links e pastas

O ERP inteiro roda no seu computador, e os links abaixo só abrem depois que você liga tudo (Parte 1).

| Link | O que é | Quando usar |
| --- | --- | --- |
| <http://localhost:5173> | **O ERP** (as telas) | Partes 2 a 8 |
| <http://localhost:3001/api/health> | Teste rápido do backend: deve mostrar `"status":"ok"` | Depois de ligar, para conferir |
| <http://localhost:3001/api/docs> | **Swagger**: a documentação da API, onde dá para testar | Parte 10 |
| <http://localhost:5678> | **n8n**: as automações (opcional) | Parte 9 |
| [Copiloto de Operações SAP com n8n](https://github.com/Efraimelm/copiloto-sap-n8n) | Projeto relacionado, de n8n | Leitura complementar |

| Caminho | O que tem |
| --- | --- |
| `C:\dev\enterprise-erp-simulator` | O projeto todo |
| `.env` | As senhas iniciais e as configurações. Ele é criado pelo `db:setup` e **nunca vai para o GitHub** |
| `integrations\n8n\` | Os 2 fluxos do n8n para importar |
| `analytics\` | O pacote do Power BI |
| `docs\demo-script.md` e `docs\apresentacao.md` | O roteiro da demonstração e o guia de apresentação |

**Os personagens:** a empresa fictícia é a **Comércio Forte (CF01)**, com dois centros: **CF10** e **CF20**. Os fornecedores são F0001 a F0003, e os clientes, C0001 a C0003.

## Parte 0: instalar (só na primeira vez)

Você precisa do [Node.js 22 ou superior](https://nodejs.org) e do Git. O banco de dados é baixado automaticamente, sem instalador e sem administrador. Abra o PowerShell e rode:

```powershell
git clone https://github.com/Efraimelm/enterprise-erp-simulator.git C:\dev\enterprise-erp-simulator
cd C:\dev\enterprise-erp-simulator
npm install
npm run db:setup
npm run migrate
npm run seed
npm run demo:data
```

| Comando | O que faz |
| --- | --- |
| `npm install` | Instala as bibliotecas |
| `npm run db:setup` | Baixa o MariaDB portátil e cria o `.env` com senhas aleatórias |
| `npm run migrate` | Cria as tabelas |
| `npm run seed` | Cria a empresa fictícia e os usuários `admin` e `auditor` |
| `npm run demo:data` | Gera 6 meses de histórico: compras, vendas, faturas e pagamentos. Assim, os relatórios já vêm com dados |

Detalhes e erros comuns estão em [setup-windows.md](setup-windows.md).

## Parte 1: ligar tudo

São três peças: o **banco de dados**, o **ERP** (backend e telas) e o **n8n**, que é opcional. Cada peça fica numa janela do PowerShell, e **essas janelas precisam continuar abertas** enquanto você usa o sistema.

1. Abra o PowerShell: tecla **Windows**, digite `PowerShell` e dê Enter.
2. Ligue o banco:

   ```powershell
   cd C:\dev\enterprise-erp-simulator
   npm run db:start
   ```

3. Ligue o ERP, na mesma janela:

   ```powershell
   npm run dev
   ```

   Espere aparecer `server_started` e `Local: http://localhost:5173/`. **Não feche essa janela**: fechar desliga o ERP.
4. Opcional: ligue o n8n numa **segunda** janela do PowerShell:

   ```powershell
   npx n8n start
   ```

   Na primeira vez demora alguns minutos. Espere aparecer `Editor is now accessible via: http://localhost:5678`.
5. Confira os links:
   - <http://localhost:3001/api/health> mostra `ok`;
   - <http://localhost:5173> mostra a tela de login;
   - <http://localhost:5678> mostra o n8n.

## Parte 2: primeiro login e tour

Você entra como **admin**, que pode tudo, e troca a senha inicial por uma sua.

1. Descubra a senha inicial:

   ```powershell
   notepad C:\dev\enterprise-erp-simulator\.env
   ```

   Procure a linha `SEED_ADMIN_PASSWORD=` e copie o que vem depois do `=`. Feche o Bloco de Notas **sem salvar**.
2. Abra <http://localhost:5173>. Usuário: `admin`. Senha: a que você copiou. Clique em **Entrar**.
3. O sistema abre a tela **Troque sua senha**. A nova senha precisa ter **12 ou mais caracteres** e pelo menos 3 destes tipos: minúscula, maiúscula, número e símbolo.
4. Você cai no **Painel**, com cartões de indicadores e o roadmap do projeto.

**Tour de 5 minutos.** Clique em cada item do menu da esquerda, só para olhar:

| Menu | O que você vê |
| --- | --- |
| **Estrutura organizacional** | Empresa CF01 → centros CF10 e CF20 → depósitos 0001 e 0002, organização de compras e áreas de vendas |
| **Parâmetros gerais** | As regras do sistema, como o limite de aprovação de compra (R$ 1.000) e o de venda (R$ 5.000) |
| **Materiais** | 6 produtos, com preço de referência e ponto de reposição |
| **Estoque** | O saldo de cada material por centro e depósito: físico, reservado e disponível |
| **Clientes** e **Condições comerciais** | Clientes e preços: geral, por canal e por cliente, mais os descontos |
| **Auditoria** | Tudo o que alguém alterou: quem, quando, antes e depois |

No topo, o campo **Nº de documento** procura qualquer documento pelo número.

## Parte 3: compras (MM), da requisição ao estoque

Você vai comprar 30 pacotes de café para o centro CF10 e receber 20. O caminho é **requisição → aprovação → pedido → recebimento → estoque**.

Regra importante: **quem pede não aprova**. Por isso, antes você cria um segundo usuário, que vai aprovar.

**A. Criar o aprovador (uma vez só)**

1. Menu **Usuários** → **+ Novo usuário**.
2. Usuário `gestor.mm`, nome "Gestor de Materiais", role **MM_MANAGER** e escopo só no **Centro CF10**. Salve.
3. A **senha provisória** aparece uma vez só. Clique em **Copiar** e guarde.

**B. Pedir (como admin)**

1. Menu **Requisições de compra** → **+ Nova requisição**.
2. Preencha:
   - centro **CF10**;
   - justificativa "Reposição de café";
   - item: material **ALM-0003 (Café torrado 500 g)**, quantidade **30** e necessidade para daqui a uma semana.
3. Clique em **Criar e enviar para aprovação**. A requisição fica **aguardando aprovação**. O admin é o solicitante, então não consegue aprovar a própria requisição.

**C. Aprovar (como gestor)**

1. Abra uma **janela anônima** (no Chrome ou no Edge: **Ctrl + Shift + N**). É outra sessão, então você fica com dois usuários ao mesmo tempo.
2. Entre com `gestor.mm` e a senha provisória, e troque a senha.
3. O menu é **menor**: o gestor só vê o que a role dele permite.
4. **Requisições de compra** → abra a requisição → **Aprovar**.

**D. Pedido de compra (como admin, na janela normal)**

1. Atualize a tela (F5). Com a requisição **aprovada**, clique em **Converter em pedido**.
2. Fornecedor **F0001** e organização de compras **CF10** → **Criar pedido (rascunho)**.
3. **Pedidos de compra** → abra o pedido (começa com 45...) → **Enviar para aprovação**. Como o valor é menor que R$ 1.000, ele é **aprovado automaticamente**.

**E. Receber a mercadoria**

1. No pedido, clique em **Registrar recebimento**.
2. Quantidade **20** → **Lançar recebimento**.
3. O sistema cria um **documento de material** (começa com 49...) com o **movimento 101**, entrada por pedido. O pedido fica **parcialmente recebido**.
4. Em **Estoque**, o saldo do ALM-0003 no CF10 subiu 20.

O estoque **nunca é editado na mão**. Ele só muda por documento de material, com registro de quem fez e quando.

Para explorar depois:
- **MRP simplificado**: sugere compras para o que está abaixo do ponto de reposição.
- Transferência entre depósitos (311) e inventário (701/702).

## Parte 4: vendas (SD), do pedido ao pagamento

Você vai vender 10 cafés para a **Padaria Pão Quente (C0003)**. O caminho é **pedido → reserva → entrega → saída → fatura → pagamento**. Faça tudo como admin.

**A. Pedido de venda**

1. **Pedidos de venda** → **+ Novo pedido**.
2. Preencha:
   - cliente **C0003**;
   - organização de vendas **CF10**, canal **10** e setor **01**;
   - centro **CF10**;
   - item **ALM-0003**, quantidade **10**.
3. **Salvar rascunho.** O preço é **R$ 23,90**, um preço especial só dessa padaria. A ordem de busca é: preço do cliente, depois do canal, depois o geral. Em cima disso entra o imposto simulado de 18%.
4. **Confirmar pedido.** O sistema verifica a disponibilidade (ATP) e **reserva** os 10. Acima de R$ 5.000, o pedido iria para aprovação.
5. Em **Estoque**, o café no CF10 tem **10 reservados**.

Se aparecer "saldo insuficiente", receba mais café antes (Parte 3).

**B. Entrega e saída de mercadoria**

1. No pedido, clique em **Criar entrega**.
2. Na entrega: **1. Confirmar separação**.
3. Depois, **2. Lançar saída de mercadoria**. É o **movimento 601**: o estoque físico e a reserva baixam juntos.

**C. Fatura e título**

1. Na entrega: **3. Faturar**. Nascem a **fatura** (começa com 90...) e o **título a receber**.
2. A fatura aparece em **Faturamento**, onde também fica o botão **Estornar fatura**.

**D. Receber o pagamento**

1. **Contas a receber (simulado)** → abra o título.
2. **Registrar pagamento (simulado)** com **metade do valor** → o título fica **parcialmente pago**.
3. Registre o resto → o título fica **quitado**.

A parte financeira é **simulada**: não há banco nem contabilidade.

## Parte 5: a trilha de documentos

1. Menu **Fluxo de documentos**.
2. Digite o número do **pagamento** (começa com 14...) e clique em **Buscar**.
3. As colunas mostram a história inteira:

   | Coluna | O que aparece |
   | --- | --- |
   | **Compras** | A requisição e o pedido de compra |
   | **Estoque** | A entrada (101) e a saída (601) |
   | **Vendas** | O pedido de venda e a entrega |
   | **Financeiro** | A fatura, o título e os pagamentos |

4. Em cada cartão:
   - **Centralizar aqui** recomeça a trilha a partir dele;
   - **Abrir** vai ao documento.

A compra se liga à venda por **FIFO simulado**: a saída é atribuída à entrada mais antiga do mesmo material e depósito. Se a saída usou estoque da carga inicial, aparece o documento 561.

## Parte 6: segurança, quem pode ver o quê

Cada usuário tem **roles**, que dizem o que ele pode fazer, e **escopo**, que diz em quais centros. Os dois são conferidos no servidor.

1. **Usuários → + Novo usuário**: `vendedor.cf10`, role **SALES**, escopo só **CF10**.
2. Numa janela anônima, entre como `vendedor.cf10` e troque a senha.
3. **Menu:** sem Administração, Compras e Contas a receber.
4. **Escopo:** em **Pedidos de venda**, só aparecem os do CF10.
5. **Trilha parcial:** no **Fluxo de documentos**, compras e financeiro ficam ocultos. A tela só informa quantos documentos foram escondidos.
6. **Teste fora do escopo:**
   - como admin, busque no Fluxo de documentos um pedido do **CF20**;
   - copie o endereço da barra do navegador (termina em `?tipo=SALES_ORDER&id=...`);
   - cole o endereço na janela do vendedor: o servidor responde **fora do escopo**.
7. **Auditoria**: mostra quem criou os usuários e quem aprovou a requisição.
8. **Roles e permissões**: são 10 roles prontas e 48 permissões. As roles do sistema são travadas. Para testar, crie uma role nova com **+ Nova role**.

## Parte 7: relatórios, Excel e Power BI

1. **Relatórios e BI** → **Vendas por período e categoria**: coloque uma data de 6 meses atrás em **De** e escolha **Mês** em **Agrupar por**.
2. Abra **Contas a receber por vencimento**: mostra o valor a vencer e as faixas de 1–30, 31–60, 61–90 e mais de 90 dias.
3. Cada relatório mostra a **fórmula** abaixo do título.
4. **Exportar CSV (Excel)** gera um arquivo no formato brasileiro, com `;` como separador e vírgula decimal.

**Power BI (opcional):** o passo a passo está em [analytics/README.md](../analytics/README.md). Resumo:

1. Crie uma chave somente leitura: **Integrações → Clientes e chaves de API → + Novo cliente**, com a role **INTEGRATION_READONLY**.
2. No Power BI Desktop, crie os parâmetros `ErpBase` e `ErpChave`.
3. Cole as consultas de `analytics/powerquery/` e as medidas de `analytics/medidas.dax`.

## Parte 8: o assistente de IA

O assistente **só consulta**, usa **as permissões de quem pergunta** e sempre mostra **a fonte**.

1. **Assistente (IA)** → pergunte `Quais materiais estão abaixo do ponto de reposição no CF10?`.
2. A resposta vem em três partes: **Fatos**, **Recomendações** e **Fonte**.
3. Outras perguntas: `Quais pedidos de venda ainda não foram entregues no CF10?` e `Qual categoria vendeu mais?`. A lista completa está em **O que você pode perguntar**.

Sem chave de IA, o assistente funciona no **modo determinista**: monta a resposta por regras, sem custo e sem internet. Para usar o Gemini:

1. Coloque uma chave sua em `GEMINI_API_KEY=`, no `.env`.
2. Reinicie o `npm run dev`.

A chave fica só no `.env`, que não vai para o GitHub.

## Parte 9: n8n, clique a clique (opcional)

O n8n conversa com o ERP de duas formas. Os arquivos estão em [integrations/n8n/](../integrations/n8n/).

- **Fluxo 10 (eventos):** o ERP **avisa** o n8n quando algo acontece, por um webhook assinado com HMAC.
- **Fluxo 11 (resumo diário):** o n8n **pergunta** ao ERP, todo dia às 7h, pela API com chave.

**A. Fluxo 10: o ERP avisando o n8n**

1. No ERP: **Integrações → Webhooks → + Novo webhook**. Use a URL `http://localhost:5678/webhook/erp-eventos` e escolha os eventos. Copie o **segredo**: ele aparece uma vez só.
2. No n8n, em [localhost:5678](http://localhost:5678), importe o arquivo `10-erp-eventos.json` (**Import from file**).
3. Abra o nó **Calcular assinatura esperada (HMAC-SHA256)** e troque `COLE_AQUI_O_SEGREDO_DO_WEBHOOK` pelo segredo. Clique em **Publish**.
4. No ERP, clique em **Testar** no webhook. Na aba **Eventos**, a entrega aparece como **Entregue**, com HTTP 200.
5. No n8n, abra **Executions** e clique na execução para ver cada nó.
6. Crie uma requisição de compra no ERP. Em até 5 segundos, o evento `purchase_requisition.created` chega no n8n.

| Nó do fluxo 10 | O que faz |
| --- | --- |
| **Webhook ERP** | Recebe o aviso |
| **Calcular assinatura esperada** | Recalcula a assinatura com o segredo compartilhado |
| **Assinatura e horário válidos?** | Confere se veio do ERP e se o aviso não é velho |
| **Montar alerta por tipo de evento** | Transforma o evento numa mensagem legível |
| **Responder 200 / 401** | Aceita ou recusa |

Se o n8n estiver desligado, a entrega fica **Falhou (vai tentar de novo)**. O ERP tenta de novo em 1 min, 5 min, 30 min, 2 h e 6 h. Para tentar na hora, use **reenviar** na linha da entrega.

**Nunca grave o segredo real no arquivo `.json` nem no GitHub.**

**B. Fluxo 11: o resumo diário**

1. No ERP: **Integrações → Clientes e chaves de API → + Novo cliente**, com a role **INTEGRATION_READONLY**. Copie a chave.
2. No n8n: **Credentials → Create credential → Header Auth**, com Name `Authorization` e Value `Bearer <chave>`.
3. Importe `11-erp-resumo-diario.json`. No nó **ERP - indicadores**, escolha a credencial.
4. Clique em **Execute workflow** e abra o nó **Montar resumo**.
5. Para rodar todo dia às 7h, clique em **Publish**.

Se der erro:
- **401**: a chave está errada ou falta o `Bearer` na frente;
- **connection refused**: o ERP está desligado.

## Parte 10: a API e o Swagger

1. Abra <http://localhost:3001/api/docs>.
2. Clique em **Authorize** e cole uma chave de API.
3. Abra **GET /kpis/summary** → **Try it out** → **Execute**. Aparecem os mesmos indicadores que o n8n usa.
4. Tente uma rota de escrita (POST) com a chave: a resposta é **403**, porque a chave é **somente leitura**.

Cada chamada feita com chave fica registrada em **Integrações → Logs**.

## Parte 11: desligar, recomeçar e problemas comuns

**Desligar:** aperte **Ctrl + C** nas janelas do ERP e do n8n. Depois desligue o banco com `npm run db:stop`.

**Recomeçar do zero.** Isto **apaga os dados** do ERP:

```powershell
npm run db:reset
npm run demo:data
```

Depois do reset, recrie o webhook e as chaves de API.

| O que aparece | Causa provável | O que fazer |
| --- | --- | --- |
| A página não abre | O ERP ou o banco está desligado | Parte 1 |
| Porta `3001` ou `5173` em uso | O ERP já está rodando em outra janela | Use a janela que já está aberta |
| Esqueci a senha do admin | — | `npm run db:reset`, que apaga os dados |
| "Saldo insuficiente" | Pouco estoque no centro | Receba mais (Parte 3) |
| "Fora do escopo" | O usuário não tem aquele centro | É a segurança funcionando |
| Webhook "Falhou" | O n8n está desligado ou o fluxo não foi publicado | Ligue o n8n e publique o fluxo |
| Webhook com HTTP 401 | O segredo é diferente entre o ERP e o n8n | Gere um **Novo segredo** e atualize o nó |

Para apresentar o projeto, use o [roteiro de demonstração](demo-script.md) e o [guia de apresentação](apresentacao.md).
