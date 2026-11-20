// Despachante de webhooks: transforma eventos em entregas e envia com assinatura HMAC e novas tentativas.
import { db } from '../db.js';
import { decrypt, signWebhook } from './crypto.js';
import { logger } from './logger.js';

export const RETRY_MINUTES = [1, 5, 30, 120, 360]; // depois da 6ª tentativa falha → DEAD
const TIMEOUT_MS = 10_000;

const matches = (sub, type) => {
  const events = typeof sub.events === 'string' ? JSON.parse(sub.events) : sub.events;
  return events.includes('*') || events.includes(type);
};

/** Cria as entregas dos eventos ainda não despachados (uma por assinatura interessada). */
export async function fanOut() {
  const events = await db('integration_events').whereNull('dispatched_at').orderBy('id').limit(200).select('id', 'event_type', 'payload');
  if (!events.length) return 0;
  const subs = await db('webhook_subscriptions').where({ is_active: true }).select('id', 'events');
  for (const ev of events) {
    const payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload;
    // O ping vai só para a assinatura que pediu o teste.
    const targets = ev.event_type === 'integration.ping' ? subs.filter((s) => s.id === payload.subscription_id) : subs.filter((s) => matches(s, ev.event_type));
    if (targets.length) {
      await db('webhook_deliveries').insert(targets.map((s) => ({ event_id: ev.id, subscription_id: s.id }))).onConflict(['event_id', 'subscription_id']).ignore();
    }
    await db('integration_events').where({ id: ev.id }).update({ dispatched_at: new Date() });
  }
  return events.length;
}

async function deliver(delivery) {
  const ev = await db('integration_events').where({ id: delivery.event_id }).first();
  const sub = await db('webhook_subscriptions').where({ id: delivery.subscription_id }).first();
  const attempt = delivery.attempts + 1;
  const body = JSON.stringify({
    id: ev.event_id,
    type: ev.event_type,
    occurred_at: new Date(ev.occurred_at).toISOString(),
    source: 'enterprise-erp-simulator',
    data: typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const started = Date.now();
  let status = null;
  let error = null;
  try {
    if (!sub.is_active) throw new Error('assinatura desativada');
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'enterprise-erp-simulator-webhooks/1.0',
        'X-ERP-Event': ev.event_type,
        'X-ERP-Event-Id': ev.event_id,
        'X-ERP-Delivery': String(delivery.id),
        'X-ERP-Timestamp': String(timestamp),
        'X-ERP-Signature': `sha256=${signWebhook(decrypt(sub.secret_encrypted), timestamp, body)}`,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = (err.name === 'TimeoutError' ? 'tempo esgotado (10 s)' : err.message).slice(0, 250);
  }
  const ok = !error;
  const dead = !ok && attempt > RETRY_MINUTES.length;
  await db('webhook_deliveries').where({ id: delivery.id }).update({
    attempts: attempt,
    status: ok ? 'SUCCESS' : dead ? 'DEAD' : 'FAILED',
    last_status_code: status,
    last_error: error,
    delivered_at: ok ? new Date() : null,
    next_attempt_at: ok || dead ? new Date() : new Date(Date.now() + RETRY_MINUTES[attempt - 1] * 60_000),
  });
  await db('integration_logs').insert({
    direction: 'OUT', subscription_id: sub.id, delivery_id: delivery.id, method: 'POST', target: sub.url.slice(0, 500),
    status_code: status, duration_ms: Date.now() - started, error,
  });
  return ok;
}

/** Uma rodada: gera entregas e envia as que estão no horário. Devolve quantas foram enviadas com sucesso/falha. */
export async function dispatchPending({ limit = 20 } = {}) {
  await fanOut();
  const due = await db('webhook_deliveries').whereIn('status', ['PENDING', 'FAILED']).where('next_attempt_at', '<=', new Date())
    .orderBy('id').limit(limit);
  const result = { sent: 0, failed: 0 };
  for (const d of due) {
    // "Aluga" a entrega por 60 s: se houver dois despachantes, só um envia.
    const claimed = await db('webhook_deliveries').where({ id: d.id, attempts: d.attempts }).whereIn('status', ['PENDING', 'FAILED'])
      .update({ next_attempt_at: new Date(Date.now() + 60_000) });
    if (!claimed) continue;
    if (await deliver(d)) result.sent++; else result.failed++;
  }
  return result;
}

let timer = null;
export function startDispatcher(intervalMs) {
  if (timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await dispatchPending(); } catch (err) { logger.error('webhook_dispatch_failed', { error: err.message }); } finally { running = false; }
  }, intervalMs);
  timer.unref();
}
export function stopDispatcher() { clearInterval(timer); timer = null; }
