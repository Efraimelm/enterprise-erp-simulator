// Transação com nova tentativa automática em caso de deadlock ou espera de trava.
// Operações de estoque concorrentes podem disputar as mesmas linhas. O banco desfaz uma delas
// (deadlock) e aqui ela é repetida do zero, de forma segura, porque tudo roda dentro da transação.
import { db } from '../db.js';

const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

export async function withTransaction(fn, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(fn);
    } catch (err) {
      if (!RETRYABLE.has(err.code) || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 60 * (attempt + 1)));
    }
  }
}
