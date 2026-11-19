// Numeração de documentos (tabela document_sequences).
// A linha da sequência é travada com FOR UPDATE dentro da transação do documento: dois usuários
// nunca recebem o mesmo número, e se a transação for desfeita o número volta (sem buracos).

export async function nextNumber(trx, docType) {
  const seq = await trx('document_sequences').where({ doc_type: docType }).forUpdate().first();
  if (!seq) throw new Error(`Sequência de documentos "${docType}" não configurada.`);
  const digits = seq.length - seq.prefix.length;
  const n = Number(seq.next_number);
  if (String(n).length > digits) throw new Error(`Faixa de numeração ${docType} esgotada.`);
  await trx('document_sequences').where({ doc_type: docType }).update({ next_number: n + 1 });
  return seq.prefix + String(n).padStart(digits, '0');
}
