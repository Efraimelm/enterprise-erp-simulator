# Roteiro de demonstração

Roteiro para apresentar o Enterprise ERP Simulator ao vivo (entrevista, banca, aula) ou gravar os vídeos do portfólio. O roteiro tem uma demonstração completa de cerca de 10 minutos e três vídeos curtos.

> Lembre sempre: é um **simulador próprio, inspirado em conceitos do SAP S/4HANA**. Não é SAP e não se conecta a um SAP.

## Preparação (uma vez, cerca de 3 minutos)

```powershell
cd C:\dev\enterprise-erp-simulator
npm run db:start      # liga o banco
npm run db:reset      # banco limpo, com os dados iniciais (apaga o que houver no erp_dev)
npm run demo:data     # cerca de 6 meses de histórico: compras, vendas, faturas e pagamentos
npm run dev           # backend :3001 e frontend :5173
```

- **Usuários:** entre como `admin`, com a senha `SEED_ADMIN_PASSWORD` do `.env`, e troque a senha no primeiro acesso. Para a parte de segurança, crie antes dois usuários na tela **Usuários**:
  - `vendedor.cf10`: role SALES, escopo só no centro CF10;
  - `gestor.mm`: role MM_MANAGER, escopo CF10.
- **Opcional:** ligue o n8n com o fluxo `10-erp-eventos` ativo para mostrar o webhook (ver `integrations/n8n/README.md`).
- **Navegador:** zoom em 110%, uma aba anônima para o segundo usuário e as notificações desligadas.

## Demonstração completa (cerca de 10 minutos)

| Tempo | Tela | O que fazer | O que falar |
| --- | --- | --- | --- |
| 0:00 | Painel | Mostrar os cartões e o roadmap | "Um ERP web que eu construí do zero para entender, na prática, os processos de MM e SD: compra, estoque, venda e recebimento" |
| 0:40 | Estrutura organizacional | Empresa CF01 → centros CF10/CF20 → depósitos, organização de compras e área de vendas | "Antes de qualquer documento vem a estrutura. Ela define o escopo de cada usuário" |
| 1:30 | Requisições → Pedidos de compra | Criar uma requisição, aprovar como gestor, converter em pedido e enviar | "Pedido acima de R$ 1.000 vai para aprovação. Quem cria não aprova (segregação de funções)" |
| 3:00 | Recebimentos → Estoque | Receber parcialmente (101) e mostrar o saldo e o documento de material | "O estoque só muda por documento de material. Não existe editar o saldo direto" |
| 4:00 | Pedidos de venda | Criar um pedido para C0001: o preço vem das condições e o ATP confirma e reserva | "O preço tem prioridade cliente > canal > geral, e a reserva impede vender o mesmo estoque duas vezes" |
| 5:00 | Entregas → Faturamento → Contas a receber | Separar, dar saída (601), faturar e registrar um pagamento parcial | "A fatura gera o título. O financeiro é simulado, sem contabilidade" |
| 6:00 | Fluxo de documentos | Abrir a trilha pelo número do pagamento | "Do pagamento até o pedido de compra que abasteceu a venda, ligados pelo FIFO simulado" |
| 7:00 | Segurança (aba anônima) | Entrar como `vendedor.cf10`: o menu é menor, outro centro dá 403 e a trilha esconde compras e financeiro | "Permissão e escopo são conferidos no backend, não só na tela" |
| 8:00 | Relatórios e BI | Vendas por mês e categoria, contas a receber por vencimento, exportar o CSV | "Cada indicador mostra a fórmula. Os mesmos números vão para o Power BI e o n8n" |
| 9:00 | Assistente | Perguntar "Quais materiais estão abaixo do ponto de reposição no CF10?" | "A IA só consulta, com as permissões de quem pergunta, e cita a fonte" |
| 9:40 | Integrações e Swagger | Mostrar a chave somente leitura, o webhook assinado e o `/api/docs` | "É assim que o n8n conversa com o ERP: chave somente leitura e eventos assinados com HMAC" |

## Três vídeos curtos (2 a 3 minutos cada)

1. **"Da requisição ao recebimento do cliente"**: telas de 1:30 a 6:00 da tabela, terminando na trilha de documentos. É o vídeo principal para recrutadores de MM/SD.
2. **"Segurança de verdade num ERP"**: roles, escopo por centro, aprovação com segregação de funções, auditoria e 403 fora do escopo.
3. **"ERP + n8n + IA + Power BI"**: o evento chega no n8n com a assinatura conferida, o assistente cita a fonte e os relatórios exportam CSV.

**Gravação:** use o Win + Alt + R (Xbox Game Bar) ou o OBS, em 1080p e só com o navegador. Legende em português e coloque o link do repositório no fim.

## Se algo der errado ao vivo
| Situação | O que fazer |
| --- | --- |
| "Saldo insuficiente" na venda | Use outro material ou centro. A mensagem já mostra o ATP funcionando |
| O n8n não recebe o evento | Mostre a aba **Integrações → Eventos**. A entrega fica registrada com as novas tentativas |
| O assistente sem chave de IA | Ele responde no modo determinista, com as mesmas fontes. Diga que esse é o plano B de propósito |
| Precisa recomeçar | `npm run db:reset` e depois `npm run demo:data` |
