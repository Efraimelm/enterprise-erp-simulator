// Log em JSON (uma linha por evento). Campos sensíveis são mascarados antes de escrever.
import { config } from '../config.js';

const SENSITIVE = /pass(word)?|senha|token|secret|cookie|authorization|api[-_]?key/i;

export function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 5) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1)]),
  );
}

function write(level, message, extra) {
  if (config.isTest && level !== 'error') return;
  const line = { time: new Date().toISOString(), level, message, ...redact(extra || {}) };
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

export const logger = {
  info: (message, extra) => write('info', message, extra),
  warn: (message, extra) => write('warn', message, extra),
  error: (message, extra) => write('error', message, extra),
};

// Registra método, rota, status e tempo de cada requisição (nunca o corpo nem os cookies).
export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('http', { method: req.method, path: req.path, status: res.statusCode, ms: +ms.toFixed(1), user: req.user?.username });
  });
  next();
}
