// Escopo organizacional (cenário de aceitação 12): usuário de um centro não acessa outro centro.
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { CLIENT_HEADER, createUser, idByCode, lastAudit, loginAs } from './helpers.js';

let ids;
let cf10Admin; // SAP_ADMIN, mas só com o centro CF10
let cf01Admin; // SAP_ADMIN com a empresa CF01 inteira
let semEscopo; // SAP_ADMIN sem nenhum escopo
let other; // segunda empresa, criada no teste

const code = () => crypto.randomBytes(2).toString('hex').toUpperCase();

beforeAll(async () => {
  ids = {
    cf01: await idByCode('companies', 'CF01'),
    cf10: await idByCode('plants', 'CF10'),
    cf20: await idByCode('plants', 'CF20'),
  };
  ids.sloc10 = (await db('storage_locations').where({ plant_id: ids.cf10, code: '0001' }).first('id')).id;
  ids.sloc20 = (await db('storage_locations').where({ plant_id: ids.cf20, code: '0001' }).first('id')).id;

  const root = await loginAs(await createUser({ roles: ['SAP_ADMIN'] }));
  const comp = await root.post('/api/org/companies').set(CLIENT_HEADER).send({
    code: code(), name: 'Outra Empresa', legal_name: 'Outra Ltda', country: 'BR', currency: 'BRL', language: 'pt-BR', timezone: 'America/Sao_Paulo',
  });
  other = comp.body.data;

  cf10Admin = await loginAs(await createUser({ roles: ['SAP_ADMIN'], scopes: [{ type: 'PLANT', plant_id: ids.cf10 }] }));
  cf01Admin = await loginAs(await createUser({ roles: ['SAP_ADMIN'], scopes: [{ type: 'COMPANY', company_id: ids.cf01 }] }));
  semEscopo = await loginAs(await createUser({ roles: ['SAP_ADMIN'], scopes: [] }));
});
afterAll(() => db.destroy());

describe('leitura respeita o escopo', () => {
  it('/me mostra o escopo do usuário', async () => {
    const res = await cf10Admin.get('/api/auth/me');
    expect(res.body.user.scopes).toEqual([expect.objectContaining({ type: 'PLANT', label: 'Centro CF10 – Matriz São Paulo' })]);
  });

  it('usuário do centro CF10 só vê o CF10, seus depósitos e a própria empresa', async () => {
    const plants = await cf10Admin.get('/api/org/plants');
    expect(plants.body.data.map((p) => p.code)).toEqual(['CF10']);
    const slocs = await cf10Admin.get('/api/org/storage-locations?pageSize=100');
    expect(new Set(slocs.body.data.map((s) => s.plant_id))).toEqual(new Set([ids.cf10]));
    const companies = await cf10Admin.get('/api/org/companies?pageSize=100');
    expect(companies.body.data.map((c) => c.code)).toEqual(['CF01']);
  });

  it('usuário do CF10 abrindo o centro CF20 recebe 403 OUT_OF_SCOPE, registrado na auditoria', async () => {
    const res = await cf10Admin.get(`/api/org/plants/${ids.cf20}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('OUT_OF_SCOPE');
    const log = await db('audit_logs').where({ result: 'DENIED', action: 'ACCESS' }).orderBy('id', 'desc').first();
    expect(JSON.stringify(log.details)).toContain('fora do escopo');
  });

  it('registro inexistente continua 404 (não 403)', async () => {
    expect((await cf10Admin.get('/api/org/plants/999999')).status).toBe(404);
  });

  it('escopo de empresa inteira vê todos os centros dela e nada da outra empresa', async () => {
    const plants = await cf01Admin.get('/api/org/plants?pageSize=100');
    expect(plants.body.data.every((p) => p.company_id === ids.cf01)).toBe(true);
    expect(plants.body.data.length).toBeGreaterThanOrEqual(2);
    expect((await cf01Admin.get(`/api/org/companies/${other.id}`)).status).toBe(403);
  });

  it('sem escopo: não vê empresas nem centros, mas vê cadastros globais', async () => {
    expect((await semEscopo.get('/api/org/companies')).body.total).toBe(0);
    expect((await semEscopo.get('/api/org/plants')).body.total).toBe(0);
    expect((await semEscopo.get('/api/org/distribution-channels')).body.total).toBeGreaterThan(0);
  });

  it('áreas de vendas seguem a empresa da organização de vendas', async () => {
    const res = await cf10Admin.get('/api/org/sales-areas?pageSize=100');
    expect(res.body.total).toBeGreaterThan(0);
    expect((await semEscopo.get('/api/org/sales-areas')).body.total).toBe(0);
  });
});

describe('escrita respeita o escopo', () => {
  it('usuário do CF10 cria depósito no CF10, mas não no CF20', async () => {
    const ok = await cf10Admin.post('/api/org/storage-locations').set(CLIENT_HEADER).send({ plant_id: ids.cf10, code: code(), name: 'Novo' });
    expect(ok.status).toBe(201);
    const denied = await cf10Admin.post('/api/org/storage-locations').set(CLIENT_HEADER).send({ plant_id: ids.cf20, code: code(), name: 'Novo' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('OUT_OF_SCOPE');
  });

  it('não move um depósito próprio para um centro fora do escopo', async () => {
    const created = (await cf10Admin.post('/api/org/storage-locations').set(CLIENT_HEADER).send({ plant_id: ids.cf10, code: code(), name: 'Mover' })).body.data;
    const res = await cf10Admin.put(`/api/org/storage-locations/${created.id}`).set(CLIENT_HEADER).send({ plant_id: ids.cf20, code: created.code, name: 'Mover', is_active: true });
    expect(res.status).toBe(403);
  });

  it('não altera nem exclui depósito de outro centro', async () => {
    const put = await cf10Admin.put(`/api/org/storage-locations/${ids.sloc20}`).set(CLIENT_HEADER).send({ plant_id: ids.cf20, code: '0001', name: 'X', is_active: true });
    expect(put.status).toBe(403);
    expect((await cf10Admin.delete(`/api/org/storage-locations/${ids.sloc20}`).set(CLIENT_HEADER)).status).toBe(403);
  });

  it('escopo de centro não altera a empresa nem cria centros; escopo de empresa cria', async () => {
    const plant = { code: code(), name: 'Centro novo', company_id: ids.cf01 };
    expect((await cf10Admin.post('/api/org/plants').set(CLIENT_HEADER).send(plant)).status).toBe(403);
    expect((await cf01Admin.post('/api/org/plants').set(CLIENT_HEADER).send(plant)).status).toBe(201);
  });

  it('criar uma empresa nova exige o escopo ALL', async () => {
    const body = { code: code(), name: 'Nova', legal_name: 'Nova Ltda', country: 'BR', currency: 'BRL', language: 'pt-BR', timezone: 'America/Sao_Paulo' };
    expect((await cf01Admin.post('/api/org/companies').set(CLIENT_HEADER).send(body)).status).toBe(403);
  });

  it('cadastros globais não dependem de escopo', async () => {
    const res = await semEscopo.post('/api/org/divisions').set(CLIENT_HEADER).send({ code: code().slice(0, 2), name: 'Setor' });
    expect([201, 409]).toContain(res.status);
  });

  it('a negação de escrita fica na auditoria com a operação', async () => {
    await cf10Admin.delete(`/api/org/storage-locations/${ids.sloc20}`).set(CLIENT_HEADER);
    const log = await lastAudit({ action: 'ACCESS', result: 'DENIED' });
    expect(JSON.stringify(log.details)).toContain('DELETE');
  });
});
