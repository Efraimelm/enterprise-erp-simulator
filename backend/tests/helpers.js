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

/** Cria um usuário de teste com as roles informadas. */
export async function createUser({ roles = [], status = 'ACTIVE', mustChange = false } = {}) {
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
