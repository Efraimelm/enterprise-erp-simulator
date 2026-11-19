// Lê e valida as variáveis de ambiente do arquivo .env na raiz do projeto.
// Se faltar alguma obrigatória, o backend nem sobe, com uma mensagem clara.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_NAME: z.string().min(1),
  DB_NAME_TEST: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(8),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  SEED_AUDITOR_PASSWORD: z.string().min(12).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const faltando = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
  throw new Error(`Configuração inválida no .env:\n  ${faltando}\nRode "npm run db:setup" para gerar o .env.`);
}
const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  isTest: env.NODE_ENV === 'test',
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  frontendOrigin: env.FRONTEND_ORIGIN,
  db: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.NODE_ENV === 'test' ? env.DB_NAME_TEST : env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  },
  session: { ttlHours: env.SESSION_TTL_HOURS, cookieName: 'erp_session' },
  login: {
    rateLimit: env.LOGIN_RATE_LIMIT,
    maxFailedAttempts: env.LOGIN_MAX_FAILED_ATTEMPTS,
    lockMinutes: env.LOGIN_LOCK_MINUTES,
  },
  seed: {
    adminPassword: env.SEED_ADMIN_PASSWORD,
    auditorPassword: env.SEED_AUDITOR_PASSWORD,
  },
};
