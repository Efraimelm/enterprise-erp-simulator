import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { CLIENT_HEADER, createUser, loginAs } from './helpers.js';

let admin;
let auditor;

beforeAll(async () => {
  admin = await loginAs(await createUser({ roles: ['SAP_ADMIN'] }));
  auditor = await loginAs(await createUser({ roles: ['AUDITOR'] }));
});
afterAll(() => db.destroy());

describe('parâmetros gerais', () => {
  it('lista os 6 parâmetros iniciais', async () => {
    const res = await auditor.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.map((s) => s.setting_key)).toEqual([
      'date_format', 'default_currency', 'default_language', 'default_timezone', 'number_locale', 'po_approval_limit',
    ]);
  });

  it('auditor não altera parâmetros', async () => {
    const res = await auditor.put('/api/settings/default_timezone').set(CLIENT_HEADER).send({ value: 'UTC' });
    expect(res.status).toBe(403);
  });

  it('valida o valor conforme o parâmetro', async () => {
    expect((await admin.put('/api/settings/default_timezone').set(CLIENT_HEADER).send({ value: 'Lua/Base' })).status).toBe(400);
    expect((await admin.put('/api/settings/date_format').set(CLIENT_HEADER).send({ value: 'dd-MM' })).status).toBe(400);
    expect((await admin.put('/api/settings/nao_existe').set(CLIENT_HEADER).send({ value: 'x' })).status).toBe(404);
  });

  it('admin altera e volta o fuso horário', async () => {
    const res = await admin.put('/api/settings/default_timezone').set(CLIENT_HEADER).send({ value: 'America/Manaus' });
    expect(res.status).toBe(200);
    expect(res.body.data.value).toBe('America/Manaus');
    await admin.put('/api/settings/default_timezone').set(CLIENT_HEADER).send({ value: 'America/Sao_Paulo' });
  });
});

describe('consulta da auditoria', () => {
  it('auditor filtra a trilha por ação e resultado', async () => {
    const res = await auditor.get('/api/audit?action=login&result=SUCCESS&pageSize=5');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((r) => r.action === 'LOGIN' && r.result === 'SUCCESS')).toBe(true);
  });

  it('nenhum registro de auditoria contém senha ou token', async () => {
    const rows = await db('audit_logs').select('details');
    const all = rows.map((r) => r.details || '').join(' ');
    expect(all).not.toMatch(/Tst-/);
    expect(all).not.toMatch(/\$argon2id\$/);
  });
});
