// Resposta do modo determinista: texto montado a partir dos resultados das ferramentas,
// separando Fatos, Estimativas e Recomendações (sem modelo de linguagem).
export const fmtBRL = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtQ = (v) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtD = (d) => (d ? String(d).split('-').reverse().join('/') : '—');

const HELP = [
  'Posso responder, com os dados que você tem permissão para ver:',
  '• Quais materiais estão abaixo do ponto de reposição?',
  '• Qual é o custo estimado de reposição?',
  '• Quais pedidos de compra estão atrasados?',
  '• Quais fornecedores possuem pedidos pendentes?',
  '• Qual categoria vendeu mais?',
  '• Quais pedidos de venda ainda não foram entregues?',
  '• Quais pedidos ainda não foram faturados?',
  'Dica: inclua o centro (ex.: "no CF10") para filtrar.',
].join('\n');

function section(r) {
  const facts = [];
  const estimates = [];
  const recs = [];
  const none = (txt) => facts.push(txt);
  switch (r.name) {
    case 'materiais_abaixo_do_ponto':
      if (!r.rows.length) none('Nenhum material está no ponto de reposição ou abaixo dele.');
      else {
        facts.push(`${r.rows.length} material(is) no ponto de reposição ou abaixo:`);
        r.rows.forEach((x) => facts.push(`• ${x.material} (${x.descricao}) no ${x.centro}: disponível ${fmtQ(x.disponivel)} ${x.unidade}, ponto ${fmtQ(x.ponto_de_reposicao)}${x.abaixo_do_minimo ? ' — abaixo do estoque mínimo' : ''}`));
        recs.push('Rodar o MRP simplificado e converter as sugestões em requisições (passam por aprovação).');
      }
      break;
    case 'custo_estimado_de_reposicao':
      if (!r.rows.length) none('Não há necessidade de reposição no momento.');
      else {
        estimates.push(`Custo estimado de reposição: ${fmtBRL(r.total_estimado)} para ${r.rows.length} item(ns).`);
        r.rows.slice(0, 10).forEach((x) => estimates.push(`• ${x.material} no ${x.centro}: comprar ${fmtQ(x.comprar)} (${x.fornecedor}) ≈ ${fmtBRL(x.valor_estimado)}`));
        estimates.push(`Método: ${r.method}`);
        recs.push('Validar preços com os fornecedores antes de aprovar as compras.');
      }
      break;
    case 'pedidos_de_compra_atrasados':
      if (!r.rows.length) none('Nenhum pedido de compra em aberto está com a entrega atrasada.');
      else {
        facts.push(`${r.rows.length} pedido(s) de compra atrasado(s):`);
        r.rows.forEach((x) => facts.push(`• ${x.pedido} — ${x.fornecedor} (${x.centro}): entrega prevista ${fmtD(x.entrega_prevista)}, ${x.dias_de_atraso} dia(s) de atraso, ${fmtBRL(x.valor)}`));
        recs.push('Contatar os fornecedores dos pedidos mais atrasados e registrar a nova data.');
      }
      break;
    case 'fornecedores_com_pedidos_pendentes':
      if (!r.rows.length) none('Nenhum fornecedor tem pedidos pendentes.');
      else {
        facts.push(`${r.rows.length} fornecedor(es) com pedidos pendentes:`);
        r.rows.forEach((x) => facts.push(`• ${x.fornecedor}: ${x.pedidos_pendentes} pedido(s), ${fmtBRL(x.valor)} — ${x.pedidos.join(', ')}`));
      }
      break;
    case 'vendas_por_categoria':
      if (!r.rows.length) none('Ainda não há faturamento registrado.');
      else {
        facts.push(`Categoria que mais vendeu: ${r.rows[0].categoria}, com ${fmtBRL(r.rows[0].faturamento_liquido)} de faturamento líquido.`);
        r.rows.forEach((x) => facts.push(`• ${x.categoria}: ${fmtBRL(x.faturamento_liquido)} (${fmtQ(x.quantidade)} unidades)`));
      }
      break;
    case 'pedidos_de_venda_nao_entregues':
      if (!r.rows.length) none('Todos os pedidos de venda confirmados já foram entregues.');
      else {
        facts.push(`${r.rows.length} pedido(s) de venda ainda não entregue(s) por completo:`);
        r.rows.forEach((x) => facts.push(`• ${x.pedido} — ${x.cliente}: faltam ${fmtQ(x.quantidade_pendente)} un., data desejada ${fmtD(x.data_desejada)}${x.atrasado ? ' (atrasado)' : ''}`));
        if (r.rows.some((x) => x.atrasado)) recs.push('Priorizar a expedição dos pedidos com data desejada vencida.');
      }
      break;
    case 'pedidos_de_venda_nao_faturados':
      if (!r.rows.length) none('Não há mercadoria entregue aguardando faturamento.');
      else {
        facts.push(`${r.rows.length} pedido(s) com mercadoria entregue e não faturada:`);
        r.rows.forEach((x) => facts.push(`• ${x.pedido} — ${x.cliente}: ${fmtBRL(x.valor_liquido_a_faturar)} líquido a faturar`));
        recs.push('Emitir as faturas das entregas já lançadas.');
      }
      break;
    default:
  }
  return { facts, estimates, recs };
}

export function renderDeterministic(message, results, { llmError } = {}) {
  if (!results.length) return `Não reconheci a pergunta.\n\n${HELP}`;
  const facts = [];
  const estimates = [];
  const recs = [];
  for (const r of results) {
    if (r.denied) { facts.push(`Sem permissão para "${r.name.replaceAll('_', ' ')}": ${r.message} Peça acesso ao administrador se precisar desse dado.`); continue; }
    const s = section(r);
    facts.push(...s.facts);
    estimates.push(...s.estimates);
    recs.push(...s.recs);
  }
  const parts = [];
  if (llmError) parts.push('(Resposta no modo determinista: o modelo de IA não respondeu.)');
  if (facts.length) parts.push(`Fatos\n${facts.join('\n')}`);
  if (estimates.length) parts.push(`Estimativas\n${estimates.join('\n')}`);
  if (recs.length) parts.push(`Recomendações (para você avaliar)\n${recs.map((x) => `• ${x}`).join('\n')}`);
  return parts.join('\n\n');
}
