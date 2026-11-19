// Trilha de auditoria: quem fez o quê, em qual registro, quando, de onde e com qual resultado.
// Nunca grava senhas, tokens ou cookies (passam pelo redact do logger).
import { db } from '../db.js';
import { logger, redact } from './logger.js';

/**
 * @param {import('express').Request|null} req  requisição (para usuário e IP), ou null
 * @param {object} entry
 * @param {string} entry.action     ex.: LOGIN, LOGOUT, CREATE, UPDATE, DELETE, ACCESS
 * @param {string} [entry.entity]   ex.: companies
 * @param {string|number} [entry.entityId]
 * @param {'SUCCESS'|'DENIED'|'FAILURE'} entry.result
 * @param {object} [entry.details]  dados relevantes (antes/depois, motivo)
 * @param {object} [entry.user]     usuário, quando ainda não está em req.user (ex.: no login)
 * @param {import('knex').Knex} [trx] transação, para gravar junto com a operação
 */
export async function audit(req, { action, entity, entityId, result, details, user }, trx = db) {
  const who = user || req?.user || null;
  try {
    await trx('audit_logs').insert({
      user_id: who?.id ?? null,
      username: who?.username ?? null,
      action,
      entity: entity ?? null,
      entity_id: entityId != null ? String(entityId) : null,
      result,
      ip: req?.ip ?? null,
      details: details ? JSON.stringify(redact(details)) : null,
    });
  } catch (err) {
    // Falha de auditoria dentro de uma transação precisa derrubar a operação.
    if (trx !== db) throw err;
    logger.error('audit_write_failed', { action, entity, error: err.message });
  }
}

// Diferença campo a campo entre o registro antes e depois de uma alteração.
export function diff(before, after) {
  const changes = {};
  for (const key of Object.keys(after)) {
    if (['updated_at', 'updated_by'].includes(key)) continue;
    const a = before?.[key];
    const b = after[key];
    if (String(a ?? '') !== String(b ?? '')) changes[key] = { de: a ?? null, para: b ?? null };
  }
  return changes;
}
