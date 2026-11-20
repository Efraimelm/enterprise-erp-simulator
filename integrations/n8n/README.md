# Fluxos n8n do Enterprise ERP Simulator

Os fluxos ligam o ERP ao projeto [Copiloto de Operações SAP com n8n](https://github.com/Efraimelm/copiloto-sap-n8n), usando a **API própria do ERP**. Não é API SAP nem OData do SAP.

| Arquivo | O que faz |
| --- | --- |
| `10-erp-eventos.json` | Recebe os eventos do ERP (webhook), **confere a assinatura HMAC** e o horário, monta um alerta por tipo de evento e responde 200. Assinatura inválida → 401, e o ERP tenta de novo |
| `11-erp-resumo-diario.json` | Todo dia às 7h (ou no botão), lê `GET /api/kpis/summary` com a chave de API e monta o resumo operacional: estoque, compras, vendas e financeiro |

## Passo a passo

### 1. Eventos (fluxo 10)
1. No ERP: **Administração → Integrações → Webhooks → Novo webhook**:
   - URL: `http://localhost:5678/webhook/erp-eventos`
   - eventos: todos ou os que quiser.
   Copie o **segredo**. Ele aparece uma vez só.
2. No n8n: **Import from file** → `10-erp-eventos.json`. No nó **Calcular assinatura esperada**, troque `COLE_AQUI_O_SEGREDO_DO_WEBHOOK` pelo segredo.
3. Clique em **Publish** no fluxo.
4. No ERP, clique em **Testar** no webhook. A entrega deve aparecer como "Entregue · HTTP 200". No n8n, a execução fica em **Executions**.

> Nunca grave o segredo real neste arquivo nem no GitHub. Se ele vazar, use **Novo segredo** no ERP e atualize o nó.

### 2. Resumo diário (fluxo 11)
1. No ERP: **Administração → Integrações → Clientes → Novo cliente**:
   - role: INTEGRATION_READONLY (só leitura);
   - escopo: os centros que você quer ver.
   Copie a **chave de API**.
2. No n8n: crie uma credencial **Header Auth**:
   - Name: `Authorization`
   - Value: `Bearer <chave>`
3. Import from file → `11-erp-resumo-diario.json` → no nó HTTP, escolha a credencial → **Execute workflow**.

## Como o ERP assina
```
X-ERP-Timestamp: 1763600000
X-ERP-Signature: sha256=<HMAC_SHA256(segredo, X-ERP-Timestamp + "." + corpo_json)>
X-ERP-Event-Id:  <uuid>   ← use para ignorar duplicatas
```
Se a resposta não for 2xx, o ERP tenta de novo em 1 min, 5 min, 30 min, 2 h e 6 h. Depois disso a entrega fica "Desistiu" e pode ser reenviada pela tela.
