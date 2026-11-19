// Administração de usuários, roles e permissões (Etapa 2).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { ROLES } from '../../database/seeders/01_permissions_roles.js';
import { app, CLIENT_HEADER, createUser, idByCode, lastAudit, loginAs, randomPassword } from './helpers.js';

let admin;
let adminUser;
let auditor;
let cf10;

const uname = () => `u${Math.random().toString(36).slice(2, 10)}`;

beforeAll(async () => {
  adminUser = await createUser({ roles: ['SAP_ADMIN'] });
  admin = await loginAs(adminUser);
  auditor = await loginAs(await createUser({ roles: ['AUDITOR'] }));
  cf10 = await idByCode('plants', 'CF10');
});
afterAll(() => db.destroy());

describe('matriz de roles (separação de funções)', () => {
  // Os cenários de rota (ex.: vendedor chamando POST /pedidos-de-compra) entram com os módulos MM/SD
  // nas Etapas 3 e 4. Aqui garantimos que as roles não concedem essas permissões.
  const has = (role, perm) => ROLES[role].permissions.includes(perm);

  it('vendedor não cria pedido de compra', () => expect(has('SALES', 'MM.PURCHASE_ORDER.CREATE')).toBe(false));
  it('almoxarife não altera cadastro de cliente', () => expect(has('WAREHOUSE', 'SD.CUSTOMER.UPDATE')).toBe(false));
  it('analistas e comprador não aprovam', () => {
    for (const r of ['MM_ANALYST', 'PROCUREMENT', 'SD_ANALYST', 'SALES']) {
      expect(ROLES[r].permissions.filter((p) => p.endsWith('.APPROVE'))).toEqual([]);
    }
  });
  it('gestores aprovam', () => {
    expect(has('MM_MANAGER', 'MM.PURCHASE_ORDER.APPROVE')).toBe(true);
    expect(has('SD_MANAGER', 'SD.SALES_ORDER.APPROVE')).toBe(true);
  });
  it('auditor só tem leitura', () => {
    expect(ROLES.AUDITOR.permissions.every((p) => p.endsWith('.READ'))).toBe(true);
  });
  it('as 9 roles de sistema existem no banco com as permissões do seed', async () => {
    const res = await admin.get('/api/admin/roles');
    const system = res.body.data.filter((r) => r.is_system);
    expect(system.map((r) => r.code).sort()).toEqual(Object.keys(ROLES).sort());
    expect(system.find((r) => r.code === 'SALES').permissions).toEqual([...ROLES.SALES.permissions].sort());
  });
});

describe('usuários', () => {
  it('cria usuário com roles e escopo; senha provisória aparece só uma vez e obriga a troca', async () => {
    const username = uname();
    const res = await admin.post('/api/admin/users').set(CLIENT_HEADER).send({
      username, full_name: 'Maria Compradora', email: `${username}@exemplo.com`, roles: ['PROCUREMENT'], scopes: [{ type: 'PLANT', plant_id: cf10 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toMatch(/^Tmp-/);
    expect(res.body.data).toMatchObject({ username, must_change_password: true, roles: [{ code: 'PROCUREMENT' }], scopes: [{ type: 'PLANT', label: 'Centro CF10' }] });
    expect(res.body.data).not.toHaveProperty('password_hash');

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').set(CLIENT_HEADER).send({ username, password: res.body.temporaryPassword });
    expect(login.body.user.must_change_password).toBe(true);
    expect((await agent.get('/api/org/plants')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const log = await lastAudit({ action: 'CREATE', entity: 'users', entity_id: String(res.body.data.id) });
    expect(JSON.stringify(log.details)).not.toContain(res.body.temporaryPassword);
  });

  it('valida usuário e recusa duplicado', async () => {
    expect((await admin.post('/api/admin/users').set(CLIENT_HEADER).send({ username: 'A b', full_name: 'X' })).status).toBe(400);
    expect((await admin.post('/api/admin/users').set(CLIENT_HEADER).send({ username: 'admin', full_name: 'Outro Admin' })).status).toBe(409);
    expect((await admin.post('/api/admin/users').set(CLIENT_HEADER).send({ username: uname(), full_name: 'Fulano', roles: ['NAO_EXISTE'] })).status).toBe(400);
  });

  it('lista com filtro por role e status', async () => {
    const res = await admin.get('/api/admin/users?role=AUDITOR&status=ACTIVE&pageSize=100');
    expect(res.status).toBe(200);
    expect(res.body.data.every((u) => u.roles.some((r) => r.code === 'AUDITOR') && u.status === 'ACTIVE')).toBe(true);
  });

  it('bloquear encerra as sessões; reativar libera o login', async () => {
    const target = await createUser({ roles: ['AUDITOR'] });
    const agent = await loginAs(target);
    const blocked = await admin.post(`/api/admin/users/${target.id}/status`).set(CLIENT_HEADER).send({ status: 'BLOCKED', reason: 'Desligamento' });
    expect(blocked.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').set(CLIENT_HEADER).send(target)).status).toBe(403);

    await admin.post(`/api/admin/users/${target.id}/status`).set(CLIENT_HEADER).send({ status: 'ACTIVE', reason: 'Retorno' });
    expect((await request(app).post('/api/auth/login').set(CLIENT_HEADER).send(target)).status).toBe(200);
    expect(await lastAudit({ action: 'STATUS', entity_id: String(target.id) })).toBeTruthy();
  });

  it('status exige motivo', async () => {
    const target = await createUser();
    expect((await admin.post(`/api/admin/users/${target.id}/status`).set(CLIENT_HEADER).send({ status: 'BLOCKED' })).status).toBe(400);
  });

  it('redefinir senha gera nova senha provisória, desbloqueia e derruba as sessões', async () => {
    const target = await createUser({ roles: ['AUDITOR'] });
    const agent = await loginAs(target);
    await db('users').where({ id: target.id }).update({ locked_until: new Date(Date.now() + 600_000) });
    const res = await admin.post(`/api/admin/users/${target.id}/reset-password`).set(CLIENT_HEADER);
    expect(res.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const login = await request(app).post('/api/auth/login').set(CLIENT_HEADER).send({ username: target.username, password: res.body.temporaryPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.must_change_password).toBe(true);
  });

  it('ninguém altera o próprio status, roles ou escopo', async () => {
    const me = adminUser.id;
    expect((await admin.post(`/api/admin/users/${me}/status`).set(CLIENT_HEADER).send({ status: 'BLOCKED', reason: 'teste' })).body.error.code).toBe('SELF_CHANGE');
    expect((await admin.put(`/api/admin/users/${me}/roles`).set(CLIENT_HEADER).send({ roles: [] })).body.error.code).toBe('SELF_CHANGE');
    expect((await admin.put(`/api/admin/users/${me}/scopes`).set(CLIENT_HEADER).send({ scopes: [] })).body.error.code).toBe('SELF_CHANGE');
  });

  it('o sistema nunca fica sem SAP_ADMIN ativo', async () => {
    // Gestor de usuários sem ser SAP_ADMIN (role personalizada).
    const role = (await admin.post('/api/admin/roles').set(CLIENT_HEADER).send({ code: `Z_GU_${Date.now() % 100000}`, name: 'Gestor de usuários', permissions: ['ADMIN.USER.READ', 'ADMIN.USER.UPDATE'] })).body.data;
    const gestor = await loginAs(await createUser({ roles: [role.code] }));
    const ultimo = await createUser({ roles: ['SAP_ADMIN'] });

    // Deixa só 'ultimo' como SAP_ADMIN ativo (os demais voltam no fim do teste).
    const outros = await db('users as u').join('user_roles as ur', 'ur.user_id', 'u.id').join('roles as r', 'r.id', 'ur.role_id')
      .where({ 'r.code': 'SAP_ADMIN', 'u.status': 'ACTIVE' }).whereNot('u.id', ultimo.id).pluck('u.id');
    await db('users').whereIn('id', outros).update({ status: 'INACTIVE' });
    try {
      const res = await gestor.post(`/api/admin/users/${ultimo.id}/status`).set(CLIENT_HEADER).send({ status: 'BLOCKED', reason: 'teste' });
      expect(res.status).toBe(409);
      expect((await db('users').where({ id: ultimo.id }).first('status')).status).toBe('ACTIVE'); // transação desfeita
    } finally {
      await db('users').whereIn('id', outros).update({ status: 'ACTIVE' });
    }
  });
});

describe('proteção contra escalada de privilégio', () => {
  it('quem não tem uma permissão não consegue concedê-la por role', async () => {
    const custom = (await admin.post('/api/admin/roles').set(CLIENT_HEADER).send({ code: `Z_USR_${Date.now() % 100000}`, name: 'Gestor de usuários', permissions: ['ADMIN.USER.READ', 'ADMIN.USER.UPDATE', 'ADMIN.ROLE.ASSIGN'] })).body.data;
    const manager = await loginAs(await createUser({ roles: [custom.code] }));
    const target = await createUser();
    const res = await manager.put(`/api/admin/users/${target.id}/roles`).set(CLIENT_HEADER).send({ roles: ['SAP_ADMIN'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });

  it('quem tem só um centro não concede escopo ALL nem outro centro', async () => {
    const plantAdmin = await loginAs(await createUser({ roles: ['SAP_ADMIN'], scopes: [{ type: 'PLANT', plant_id: cf10 }] }));
    const target = await createUser({ scopes: [] });
    const cf20 = await idByCode('plants', 'CF20');
    expect((await plantAdmin.put(`/api/admin/users/${target.id}/scopes`).set(CLIENT_HEADER).send({ scopes: [{ type: 'ALL' }] })).status).toBe(403);
    expect((await plantAdmin.put(`/api/admin/users/${target.id}/scopes`).set(CLIENT_HEADER).send({ scopes: [{ type: 'PLANT', plant_id: cf20 }] })).status).toBe(403);
    expect((await plantAdmin.put(`/api/admin/users/${target.id}/scopes`).set(CLIENT_HEADER).send({ scopes: [{ type: 'PLANT', plant_id: cf10 }] })).status).toBe(200);
  });

  it('escopo ALL substitui os demais', async () => {
    const target = await createUser({ scopes: [] });
    const res = await admin.put(`/api/admin/users/${target.id}/scopes`).set(CLIENT_HEADER).send({ scopes: [{ type: 'PLANT', plant_id: cf10 }, { type: 'ALL' }] });
    expect(res.body.data.scopes).toEqual([expect.objectContaining({ type: 'ALL' })]);
  });

  it('escopo com centro inexistente é recusado', async () => {
    const target = await createUser({ scopes: [] });
    expect((await admin.put(`/api/admin/users/${target.id}/scopes`).set(CLIENT_HEADER).send({ scopes: [{ type: 'PLANT', plant_id: 999999 }] })).status).toBe(400);
  });
});

describe('roles personalizadas', () => {
  it('cria, altera e exclui role Z_; registra auditoria', async () => {
    const code = `Z_TESTE_${Date.now() % 100000}`;
    const created = await admin.post('/api/admin/roles').set(CLIENT_HEADER).send({ code, name: 'Compras CF10', permissions: ['MM.MATERIAL.READ'] });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const updated = await admin.put(`/api/admin/roles/${id}`).set(CLIENT_HEADER).send({ name: 'Compras CF10', permissions: ['MM.MATERIAL.READ', 'MM.STOCK.READ'] });
    expect(updated.body.data.permissions).toEqual(['MM.MATERIAL.READ', 'MM.STOCK.READ']);
    const log = await lastAudit({ action: 'UPDATE', entity: 'roles', entity_id: String(id) });
    expect(JSON.stringify(log.details)).toContain('MM.STOCK.READ');
    expect((await admin.delete(`/api/admin/roles/${id}`).set(CLIENT_HEADER)).status).toBe(204);
  });

  it('código precisa começar com Z_', async () => {
    expect((await admin.post('/api/admin/roles').set(CLIENT_HEADER).send({ code: 'COMPRAS', name: 'Compras', permissions: [] })).status).toBe(400);
  });

  it('roles de sistema não podem ser alteradas nem excluídas', async () => {
    const id = await idByCode('roles', 'SALES');
    expect((await admin.put(`/api/admin/roles/${id}`).set(CLIENT_HEADER).send({ name: 'x', permissions: [] })).body.error.code).toBe('SYSTEM_ROLE');
    expect((await admin.delete(`/api/admin/roles/${id}`).set(CLIENT_HEADER)).status).toBe(403);
  });

  it('role com usuários não pode ser excluída', async () => {
    const role = (await admin.post('/api/admin/roles').set(CLIENT_HEADER).send({ code: `Z_USO_${Date.now() % 100000}`, name: 'Em uso', permissions: [] })).body.data;
    await createUser({ roles: [role.code] });
    expect((await admin.delete(`/api/admin/roles/${role.id}`).set(CLIENT_HEADER)).status).toBe(409);
  });
});

describe('autorização das rotas de administração', () => {
  it('auditor consulta usuários e roles, mas não altera nada', async () => {
    expect((await auditor.get('/api/admin/users')).status).toBe(200);
    expect((await auditor.get('/api/admin/roles')).status).toBe(200);
    expect((await auditor.post('/api/admin/users').set(CLIENT_HEADER).send({ username: uname(), full_name: 'Teste' })).status).toBe(403);
    expect((await auditor.post('/api/admin/roles').set(CLIENT_HEADER).send({ code: 'Z_X1', name: 'X', permissions: [] })).status).toBe(403);
  });

  it('vendedor não acessa a administração', async () => {
    const vendedor = await loginAs(await createUser({ roles: ['SALES'] }));
    expect((await vendedor.get('/api/admin/users')).status).toBe(403);
    expect((await vendedor.post('/api/org/plants').set(CLIENT_HEADER).send({})).status).toBe(403);
  });

  it('usuário de depósito não altera estrutura nem parâmetros', async () => {
    const almox = await loginAs(await createUser({ roles: ['WAREHOUSE'] }));
    expect((await almox.get('/api/org/plants')).status).toBe(200);
    expect((await almox.put('/api/settings/default_currency').set(CLIENT_HEADER).send({ value: 'USD' })).status).toBe(403);
  });

  it('a troca de senha do próprio usuário continua funcionando', async () => {
    const u = await createUser({ roles: ['SALES'] });
    const agent = await loginAs(u);
    expect((await agent.post('/api/auth/change-password').set(CLIENT_HEADER).send({ current_password: u.password, new_password: randomPassword() })).status).toBe(200);
  });
});
