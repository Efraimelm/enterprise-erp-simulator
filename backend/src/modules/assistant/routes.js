// Assistente de IA (Etapa 6) — só consulta, com as permissões de quem pergunta (decisão A9).
//   GET  /api/assistant/capabilities   AI.ASSISTANT.USE   ferramentas que ESTE usuário pode usar e o modo
//   POST /api/assistant/chat           AI.ASSISTANT.USE   { message, history? } → { answer, mode, sources, tools_used, denied }
//
// Modo LLM (GEMINI_API_KEY no .env): o Gemini escolhe as ferramentas (function calling) e redige.
// Modo DETERMINISTIC (sem chave ou se o Gemini falhar): reconhece as perguntas previstas e responde
// com os mesmos dados. Em ambos, a lista de fontes é montada pelo backend, não pelo modelo.
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db.js';
import { logger } from '../../lib/logger.js';
import { fmtBRL, renderDeterministic } from './render.js';
import { canUseTool, runTool, TOOLS } from './tools.js';
import { requirePermission } from '../../middleware/auth.js';

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Reconhecimento simples das perguntas previstas na especificação (modo determinista). */
export function detectIntents(message) {
  const m = fold(message);
  const intents = [];
  if (/custo|valor|quanto custa|orcamento/.test(m) && /repo/.test(m)) intents.push('custo_estimado_de_reposicao');
  else if (/(abaixo|baixo|falta|repor|reposicao|ponto)/.test(m) && /(material|estoque|produto|ponto|repo)/.test(m)) intents.push('materiais_abaixo_do_ponto');
  if (/atrasad/.test(m) && /compra|fornecedor|pc\b/.test(m)) intents.push('pedidos_de_compra_atrasados');
  if (/fornecedor/.test(m) && /pendent|aberto|em aberto/.test(m)) intents.push('fornecedores_com_pedidos_pendentes');
  if (/categoria/.test(m) || (/vend/.test(m) && /mais/.test(m))) intents.push('vendas_por_categoria');
  if (/(nao|ainda).*(entreg)/.test(m) || /pendentes? de entrega/.test(m)) intents.push('pedidos_de_venda_nao_entregues');
  if (/(nao|ainda).*(fatur)/.test(m) || /a faturar/.test(m)) intents.push('pedidos_de_venda_nao_faturados');
  const plant = /\b(cf\d{2})\b/i.exec(message)?.[1]?.toUpperCase();
  return { intents: [...new Set(intents)], args: plant ? { plant_code: plant } : {} };
}

const SYSTEM = `Você é o assistente do Enterprise ERP Simulator (ERP educacional que simula processos inspirados no SAP S/4HANA; NÃO é um SAP real).
Regras obrigatórias:
1. Use SOMENTE os dados devolvidos pelas ferramentas. Nunca invente números, documentos, clientes ou fornecedores.
2. Se uma ferramenta devolver "denied", diga que o usuário não tem permissão para aquele dado. Não tente contornar.
3. Se não houver dados, diga isso claramente.
4. Não faça contas de cabeça: use os totais que as ferramentas já calcularam.
5. Você só consulta. Nunca diga que aprovou, alterou, criou ou cancelou algo.
6. Organize a resposta em português do Brasil com as seções "Fatos", "Estimativas" (só se houver) e "Recomendações" (sugestões para a pessoa avaliar).
7. Cite os números dos documentos relevantes. As fontes serão anexadas automaticamente pelo sistema.`;

/** Chamada ao Gemini (REST). Separada para os testes poderem simular a resposta. */
export async function callGemini(contents, tools) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.ai.model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.ai.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      tools: [{ functionDeclarations: tools }],
      generationConfig: { temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  return res.json();
}

async function chatWithLlm(req, message, history, executed) {
  const tools = Object.entries(TOOLS).filter(([name]) => canUseTool(req, name)).map(([name, t]) => ({
    name, description: t.description,
    parameters: { type: 'object', properties: { plant_code: { type: 'string', description: 'Código do centro (ex.: CF10). Opcional.' } } },
  }));
  const contents = [
    ...history.slice(-6).map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content.slice(0, 2000) }] })),
    { role: 'user', parts: [{ text: message }] },
  ];
  for (let round = 0; round < 4; round++) {
    const out = await callGemini(contents, tools);
    const parts = out?.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) return parts.map((p) => p.text ?? '').join('').trim();
    contents.push({ role: 'model', parts });
    const responses = [];
    for (const c of calls) {
      const r = await runTool(req, c.functionCall.name, c.functionCall.args ?? {});
      executed.push(r);
      const { name, ...rest } = r;
      responses.push({ functionResponse: { name: c.functionCall.name, response: { result: rest } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  throw new Error('O modelo não concluiu a resposta em 4 rodadas.');
}

const sourceOf = (r) => ({ tool: r.name, label: TOOLS[r.name]?.description, endpoint: r.endpoint, documents: (r.documents ?? []).slice(0, 50) });

export const assistantRouter = Router();

assistantRouter.get('/capabilities', requirePermission('AI.ASSISTANT.USE'), (req, res) => {
  res.json({
    data: {
      mode: config.ai.geminiKey ? 'LLM' : 'DETERMINISTIC',
      model: config.ai.geminiKey ? config.ai.model : null,
      tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, allowed: canUseTool(req, name) })),
      examples: [
        'Quais materiais estão abaixo do ponto de reposição?', 'Qual é o custo estimado de reposição?', 'Quais pedidos de compra estão atrasados?',
        'Quais fornecedores possuem pedidos pendentes?', 'Qual categoria vendeu mais?', 'Quais pedidos de venda ainda não foram entregues?',
        'Quais pedidos ainda não foram faturados?',
      ],
    },
  });
});

assistantRouter.post('/chat', requirePermission('AI.ASSISTANT.USE'), async (req, res) => {
  const body = z.object({
    message: z.string().trim().min(3, 'Escreva a pergunta.').max(500),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }).strict()).max(20).default([]),
  }).strict().parse(req.body);
  const started = Date.now();
  const executed = [];
  let mode = 'DETERMINISTIC';
  let answer;
  let error = null;

  if (config.ai.geminiKey) {
    try {
      answer = await chatWithLlm(req, body.message, body.history, executed);
      mode = 'LLM';
    } catch (err) {
      error = err.message.slice(0, 250);
      logger.warn('assistant_llm_failed', { error: error });
      executed.length = 0;
    }
  }
  if (mode === 'DETERMINISTIC') {
    const { intents, args } = detectIntents(body.message);
    for (const name of intents) executed.push(await runTool(req, name, args));
    answer = renderDeterministic(body.message, executed, { llmError: error });
  }

  const used = executed.filter((r) => !r.denied && !r.error);
  const denied = executed.filter((r) => r.denied).map((r) => ({ tool: r.name, message: r.message }));
  const sources = used.map(sourceOf);
  await db('ai_queries').insert({
    user_id: req.user.id, question: body.message, mode, tools_used: JSON.stringify(executed.map((r) => ({ tool: r.name, denied: !!r.denied }))),
    sources: JSON.stringify(sources.map((s) => ({ tool: s.tool, documents: s.documents.slice(0, 20) }))), duration_ms: Date.now() - started, error,
  });
  res.json({ data: { answer, mode, sources, tools_used: executed.map((r) => r.name), denied, note: 'Somente consulta: o assistente não executa operações no ERP.', fallback_reason: error ? 'O modelo de IA falhou; resposta gerada no modo determinista.' : null } });
});

export { fmtBRL };
