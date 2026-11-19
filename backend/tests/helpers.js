// Utilitários dos testes: cria usuários com senha aleatória e devolve um "agente" já logado.
import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';

export const app = createApp({ loginRateLimit: 10_000 });

// Toda escrita pela API precisa deste cabeçalho (proteção CSRF).
export const CLIENT_HEADER = { 'X-ERP-Client': 'web' };

export const randomPassword = () => `Tst-${crypto.randomBytes(9).toString('base64url')}9a`;

/**
 * Cria um usuário de teste com as roles e o escopo informados.
 * scopes: [{ type: 'ALL' }] (padrão) | [{ type: 'COMPANY', company_id }] | [{ type: 'PLANT', plant_id }] | []
 */
export async function createUser({ roles = [], status = 'ACTIVE', mustChange = false, scopes = [{ type: 'ALL' }] } = {}) {
  const username = `t_${crypto.randomBytes(4).toString('hex')}`;
  const password = randomPassword();
  const [id] = await db('users').insert({
    username,
    full_name: `Usuário de teste ${username}`,
    password_hash: await hashPassword(password),
    status,
    must_change_password: mustChange,
  });
  for (const code of roles) {
    const role = await db('roles').where({ code }).first('id');
    await db('user_roles').insert({ user_id: id, role_id: role.id });
  }
  for (const s of scopes) {
    await db('user_org_scopes').insert({ user_id: id, scope_type: s.type, company_id: s.company_id ?? null, plant_id: s.plant_id ?? null });
  }
  return { id, username, password };
}

/** Faz login e devolve um agente supertest que mantém o cookie de sessão. */
export async function loginAs(user) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').set(CLIENT_HEADER).send({ username: user.username, password: user.password });
  if (res.status !== 200) throw new Error(`Login falhou (${res.status}): ${JSON.stringify(res.body)}`);
  return agent;
}

export const lastAudit = (where) => db('audit_logs').where(where).orderBy('id', 'desc').first();

/** id de um registro pelo código (ex.: idByCode('plants', 'CF10')). */
export const idByCode = async (table, code, extra = {}) => (await db(table).where({ code, ...extra }).first('id')).id;
