import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { db } from '../src/db.js';
import { app, CLIENT_HEADER, createUser, lastAudit, loginAs, randomPassword } from './helpers.js';

afterAll(() => db.destroy());

describe('saúde da API', () => {
  it('GET /api/health responde ok com o banco conectado', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok', environment: 'test' });
  });

  it('rota inexistente responde 404 em JSON', async () => {
    const res = await request(app).get('/api/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('login', () => {
  it('login correto cria sessão em cookie HttpOnly e SameSite=Strict', async () => {
    const user = await createUser({ roles: ['SAP_ADMIN'] });
    const res = await request(app).post('/api/auth/login').set(CLIENT_HEADER).send({ username: user.username, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(user.username);
    expect(res.body.user.permissions).toContain('ADMIN.ORG.CREATE');
    expect(res.body.user).not.toHaveProperty('password_hash');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(await lastAudit({ action: 'LOGIN', username: user.username })).toMatchObject({ result: 'SUCCESS' });
  });

  it('o token da sessão não é gravado em texto puro no banco', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/auth/login').set(CLIENT_HEADER).send({ username: user.username, password: user.password });
    const token = res.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const sessions = await db('sessions').where({ user_id: user.id });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].token_hash).not.toBe(token);
    expect(sessions[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('senha errada e usuário inexistente recebem a MESMA resposta genérica', async () => {
    const user = await createUser();
    const wrong = await request(app).post('/api/auth/login').set(CLIENT_HEADER).send({ username: user.username, password: 'Errada-123456' });
    const unknown = await request(app).post('/api/auth/login').set(CLIENT_HEADER).send({ username: 'nao_existe', password: 'Errada-123456' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    const log = await lastAudit({ action: 'LOGIN', username: user.username });
    expect(log.result).toBe('FAILURE');
    expect(JSON.stringify(log.details)).not.toContain('Errada-123456');
  });

  it(`bloqueia a conta por ${config.login.lockMinutes} min após ${config.login.maxFailedAttempts} senhas erradas`, async () => {
    const user = await createUser();
    for (let i = 0; i < config.login.maxFailedAttempts; i++) {
      await request(app).post('/api/auth/login').set(CLIENT_HEADER).send({ username: user.username, password: 'Errada-123456' });
    }
    const res = await request(app).post('/api/auth/login').set(CLIENT_HEADER).send({ username: user.username, password: user.password });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('usuário bloqueado pelo administrador não consegue entrar', async () => {
    const user = await createUser({ status: 'BLOCKED' });
    const res = await request(app).post('/api/auth/login').set(CLIENT_HEADER).send({ username: user.username, password: user.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_BLOCKED');
    expect(await lastAudit({ action: 'LOGIN', username: user.username })).toMatchObject({ result: 'DENIED' });
  });

  it('usuário bloqueado perde as sessões já abertas', async () => {
    const user = await createUser({ roles: ['AUDITOR'] });
    const agent = await loginAs(user);
    await db('users').where({ id: user.id }).update({ status: 'BLOCKED' });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('limita tentativas de login por IP (rate limit)', async () => {
    const limited = createApp({ loginRateLimit: 3 });
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(limited).post('/api/auth/login').set(CLIENT_HEADER).send({ username: 'x', password: 'y' });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('entrada inválida responde 400 com o campo do erro', async () => {
    const res = await request(app).post('/api/auth/login').set(CLIENT_HEADER).send({ username: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toEqual(expect.arrayContaining(['username', 'password']));
  });
});

describe('sessão e CSRF', () => {
  it('sem login, /me responde 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('logout encerra a sessão', async () => {
    const agent = await loginAs(await createUser());
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await agent.post('/api/auth/logout').set(CLIENT_HEADER)).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('POST sem o cabeçalho X-ERP-Client é recusado (CSRF)', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'a', password: 'b' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('POST vindo de outra origem é recusado (CSRF)', async () => {
    const res = await request(app).post('/api/auth/login').set(CLIENT_HEADER).set('Origin', 'https://site-malicioso.exemplo').send({ username: 'a', password: 'b' });
    expect(res.status).toBe(403);
  });
});

describe('troca de senha obrigatória', () => {
  it('usuário com senha provisória só acessa o sistema depois de trocar a senha', async () => {
    const user = await createUser({ roles: ['SAP_ADMIN'], mustChange: true });
    const agent = await loginAs(user);

    const blocked = await agent.get('/api/org/companies');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await agent.post('/api/auth/change-password').set(CLIENT_HEADER).send({ current_password: user.password, new_password: 'curta' });
    expect(weak.status).toBe(400);

    const wrongCurrent = await agent.post('/api/auth/change-password').set(CLIENT_HEADER).send({ current_password: 'Errada-123456', new_password: randomPassword() });
    expect(wrongCurrent.status).toBe(400);

    const ok = await agent.post('/api/auth/change-password').set(CLIENT_HEADER).send({ current_password: user.password, new_password: randomPassword() });
    expect(ok.status).toBe(200);
    expect(ok.body.user.must_change_password).toBe(false);

    expect((await agent.get('/api/org/companies')).status).toBe(200);
  });

  it('a nova senha não pode conter o nome de usuário', async () => {
    const user = await createUser({ mustChange: true });
    const agent = await loginAs(user);
    const res = await agent.post('/api/auth/change-password').set(CLIENT_HEADER).send({ current_password: user.password, new_password: `Xx9-${user.username}-abc` });
    expect(res.status).toBe(400);
  });
});
