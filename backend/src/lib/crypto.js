// Cifra simétrica (AES-256-GCM) para segredos que o sistema precisa reler, como o segredo HMAC
// de cada webhook. Hash (SHA-256) para segredos que só precisam ser conferidos, como as chaves de API.
import crypto from 'node:crypto';
import { config } from '../config.js';

const key = () => crypto.createHash('sha256').update(config.integration.webhookSecretKey).digest();

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(token) {
  const [v, iv, tag, data] = String(token).split('.');
  if (v !== 'v1') throw new Error('Formato de segredo cifrado desconhecido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Assinatura de webhook: HMAC-SHA256(segredo, `${timestamp}.${corpo}`) em hexadecimal. */
export const signWebhook = (secret, timestamp, body) =>
  crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

export const randomSecret = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
