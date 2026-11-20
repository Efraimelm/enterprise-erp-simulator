// Idempotência para POST: com o cabeçalho `Idempotency-Key`, repetir a mesma requisição devolve a
// resposta original em vez de executar de novo (clique duplo, nova tentativa do n8n, rede instável).
import { db } from '../db.js';
import { sha256 } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';

const TTL_MS = 24 * 3600_000;

export async function idempotency(req, res, next) {
  const key = req.get('idempotency-key');
  if (req.method !== 'POST' || !key || !req.user) return next();
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(key)) {
    throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key deve ter de 8 a 100 caracteres (letras, números, _ . : -).');
  }
  const path = req.originalUrl.split('?')[0].slice(0, 255);
  const requestHash = sha256(JSON.stringify(req.body ?? {}));
  const where = { user_id: req.user.id, idem_key: key, method: 'POST', path };

  await db('idempotency_keys').where(where).where('created_at', '<', new Date(Date.now() - TTL_MS)).del();
  const inserted = await db('idempotency_keys').insert({ ...where, request_hash: requestHash, state: 'IN_PROGRESS' }).onConflict(['user_id', 'idem_key', 'method', 'path']).ignore();
  if (!inserted?.[0]) {
    const prev = await db('idempotency_keys').where(where).first();
    if (prev.request_hash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Esta Idempotency-Key já foi usada com outro conteúdo.');
    if (prev.state === 'IN_PROGRESS') throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'A requisição original ainda está sendo processada. Tente de novo em instantes.');
    res.set('Idempotent-Replay', 'true');
    return res.status(prev.status_code).type('application/json').send(prev.response_body);
  }

  // Grava a resposta ANTES de enviá-la: assim, uma repetição que chegue logo depois já encontra o
  // resultado pronto. Erro 5xx libera a chave para nova tentativa.
  let stored = false;
  const store = (status, body) => {
    stored = true;
    const q = db('idempotency_keys').where(where);
    return status >= 500 ? q.del() : q.update({ state: 'DONE', status_code: status, response_body: body === undefined ? '' : JSON.stringify(body) });
  };
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    store(res.statusCode, payload).catch(() => {}).finally(() => originalJson(payload));
    return res;
  };
  res.on('finish', () => { if (!stored) store(res.statusCode, undefined).catch(() => {}); });
  next();
}
