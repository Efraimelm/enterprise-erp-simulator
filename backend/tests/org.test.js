import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { CLIENT_HEADER, createUser, lastAudit, loginAs } from './helpers.js';

let admin;
let auditor;
let semPermissao;

// Código aleatório para não colidir com os dados do seed nem entre execuções.
const newCode = (len = 4) => crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, len);

const company = (overrides = {}) => ({
  code: newCode(),
  name: 'Empresa Teste',
  legal_name: 'Empresa Teste Ltda',
  country: 'br',
  currency: 'brl',
  language: 'pt-BR',
  timezone: 'America/Sao_Paulo',
  ...overrides,
});

beforeAll(async () => {
  admin = await loginAs(await createUser({ roles: ['SAP_ADMIN'] }));
  auditor = await loginAs(await createUser({ roles: ['AUDITOR'] }));
  semPermissao = await loginAs(await createUser({ roles: [] }));
});
afterAll(() => db.destroy());

describe('estrutura organizacional: dados de demonstração', () => {
  it('a empresa CF01 e seus dois centros vêm do seed', async () => {
    const companies = await admin.get('/api/org/companies?q=CF01');
    const cf01 = companies.body.data.find((c) => c.code === 'CF01');
    expect(cf01).toMatchObject({ code: 'CF01', currency: 'BRL', is_active: true });
    const plants = await admin.get(`/api/org/plants?company_id=${cf01.id}`);
    // Outros arquivos de teste podem ter criado centros na CF01: confere que os do seed estão lá.
    expect(plants.body.data.map((p) => p.code)).toEqual(expect.arrayContaining(['CF10', 'CF20']));
  });

  it('/meta descreve as 10 entidades e seus campos', async () => {
    const res = await admin.get('/api/org/meta');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.find((e) => e.key === 'plants').fields.find((f) => f.name === 'company_id')).toMatchObject({ type: 'ref', ref: 'companies' });
  });
});

describe('CRUD de empresas', () => {
  it('cria empresa, normaliza códigos para maiúsculas e registra auditoria', async () => {
    const res = await admin.post('/api/org/companies').set(CLIENT_HEADER).send(company());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ country: 'BR', currency: 'BRL', is_active: true });
    const log = await lastAudit({ action: 'CREATE', entity: 'companies', entity_id: String(res.body.data.id) });
    expect(log.result).toBe('SUCCESS');
  });

  it('valida moeda, fuso e campos obrigatórios com mensagens por campo', async () => {
    const res = await admin.post('/api/org/companies').set(CLIENT_HEADER).send(company({ currency: 'REAL', timezone: 'Marte/Base', name: '' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['currency', 'name', 'timezone']);
  });

  it('recusa campos que não existem na entidade', async () => {
    const res = await admin.post('/api/org/companies').set(CLIENT_HEADER).send({ ...company(), id: 999, created_by: 1 });
    expect(res.status).toBe(400);
  });

  it('código duplicado responde 409', async () => {
    const res = await admin.post('/api/org/companies').set(CLIENT_HEADER).send(company({ code: 'CF01' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE');
  });

  it('altera e registra no log só os campos que mudaram', async () => {
    const created = (await admin.post('/api/org/companies').set(CLIENT_HEADER).send(company())).body.data;
    const { id, created_at, updated_at, created_by, updated_by, ...body } = created;
    const res = await admin.put(`/api/org/companies/${id}`).set(CLIENT_HEADER).send({ ...body, name: 'Nome Alterado' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Nome Alterado');
    const log = await lastAudit({ action: 'UPDATE', entity: 'companies', entity_id: String(id) });
    const details = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
    expect(details.alteracoes).toEqual({ name: { de: 'Empresa Teste', para: 'Nome Alterado' } });
  });

  it('paginação devolve total e respeita pageSize', async () => {
    const res = await admin.get('/api/org/companies?page=1&pageSize=1&sort=code&order=desc');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBeGreaterThan(1);
  });

  it('registro inexistente responde 404', async () => {
    expect((await admin.get('/api/org/companies/999999')).status).toBe(404);
    expect((await admin.get('/api/org/nao-existe')).status).toBe(404);
  });
});

describe('integridade entre estruturas', () => {
  it('centro com empresa inexistente responde 422', async () => {
    const res = await admin.post('/api/org/plants').set(CLIENT_HEADER).send({ code: newCode(), name: 'Centro', company_id: 999999 });
    expect(res.status).toBe(422);
  });

  it('não exclui empresa que tem centros; exclui depósito sem vínculos', async () => {
    const comp = (await admin.post('/api/org/companies').set(CLIENT_HEADER).send(company())).body.data;
    const plant = (await admin.post('/api/org/plants').set(CLIENT_HEADER).send({ code: newCode(), name: 'Centro X', company_id: comp.id, state: 'sp' })).body.data;
    expect(plant.state).toBe('SP');
    const sloc = (await admin.post('/api/org/storage-locations').set(CLIENT_HEADER).send({ plant_id: plant.id, code: '0001', name: 'Depósito' })).body.data;

    const blocked = await admin.delete(`/api/org/companies/${comp.id}`).set(CLIENT_HEADER);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('IN_USE');

    expect((await admin.delete(`/api/org/storage-locations/${sloc.id}`).set(CLIENT_HEADER)).status).toBe(204);
    expect(await lastAudit({ action: 'DELETE', entity: 'storage_locations', entity_id: String(sloc.id) })).toBeTruthy();
  });

  it('o mesmo código de depósito pode existir em centros diferentes, mas não repetido no mesmo centro', async () => {
    const plants = (await admin.get('/api/org/plants?q=CF&pageSize=100')).body.data;
    const cf10 = plants.find((p) => p.code === 'CF10');
    const cf20 = plants.find((p) => p.code === 'CF20');
    const code = newCode();
    expect((await admin.post('/api/org/storage-locations').set(CLIENT_HEADER).send({ plant_id: cf10.id, code, name: 'A' })).status).toBe(201);
    expect((await admin.post('/api/org/storage-locations').set(CLIENT_HEADER).send({ plant_id: cf20.id, code, name: 'B' })).status).toBe(201);
    expect((await admin.post('/api/org/storage-locations').set(CLIENT_HEADER).send({ plant_id: cf10.id, code, name: 'C' })).status).toBe(409);
  });

  it('a mesma área de vendas não pode ser cadastrada duas vezes', async () => {
    const area = (await admin.get('/api/org/sales-areas?pageSize=1')).body.data[0];
    const res = await admin.post('/api/org/sales-areas').set(CLIENT_HEADER).send({
      sales_organization_id: area.sales_organization_id,
      distribution_channel_id: area.distribution_channel_id,
      division_id: area.division_id,
    });
    expect(res.status).toBe(409);
  });
});

describe('autorização no backend', () => {
  it('auditor consulta, mas não cria (403) e a negação fica na auditoria', async () => {
    expect((await auditor.get('/api/org/companies')).status).toBe(200);
    const res = await auditor.post('/api/org/companies').set(CLIENT_HEADER).send(company());
    expect(res.status).toBe(403);
    const log = await db('audit_logs').where({ result: 'DENIED', action: 'ACCESS' }).orderBy('id', 'desc').first();
    expect(JSON.stringify(log.details)).toContain('ADMIN.ORG.CREATE');
  });

  it('usuário sem nenhuma role não consulta nada', async () => {
    expect((await semPermissao.get('/api/org/companies')).status).toBe(403);
    expect((await semPermissao.get('/api/settings')).status).toBe(403);
    expect((await semPermissao.get('/api/audit')).status).toBe(403);
  });

  it('chamada direta à API sem login responde 401', async () => {
    const { default: request } = await import('supertest');
    const { app } = await import('./helpers.js');
    expect((await request(app).get('/api/org/companies')).status).toBe(401);
    expect((await request(app).delete('/api/org/companies/1').set(CLIENT_HEADER)).status).toBe(401);
  });
});
