// Usuários de demonstração. As senhas iniciais vêm do .env (SEED_ADMIN_PASSWORD e
// SEED_AUDITOR_PASSWORD) e precisam ser trocadas no primeiro login.
// Se o usuário já existir, a senha dele NÃO é alterada.
import { config } from '../../backend/src/config.js';
import { hashPassword } from '../../backend/src/lib/password.js';

const USERS = [
  { username: 'admin', full_name: 'Administrador do ERP', email: 'admin@comercioforte.exemplo', role: 'SAP_ADMIN', password: () => config.seed.adminPassword },
  { username: 'auditor', full_name: 'Auditoria Interna', email: 'auditoria@comercioforte.exemplo', role: 'AUDITOR', password: () => config.seed.auditorPassword },
];

export async function seed(knex) {
  for (const u of USERS) {
    let user = await knex('users').where({ username: u.username }).first('id');
    if (!user) {
      const password = u.password();
      if (!password) throw new Error(`Defina a senha inicial de "${u.username}" no .env antes do seed.`);
      const [id] = await knex('users').insert({
        username: u.username,
        full_name: u.full_name,
        email: u.email,
        password_hash: await hashPassword(password),
        must_change_password: true,
      });
      user = { id };
    }
    const role = await knex('roles').where({ code: u.role }).first('id');
    await knex('user_roles').insert({ user_id: user.id, role_id: role.id }).onConflict(['user_id', 'role_id']).ignore();
    // Escopo inicial: todas as empresas e centros (só se o usuário ainda não tiver escopo).
    const hasScope = await knex('user_org_scopes').where({ user_id: user.id }).first('id');
    if (!hasScope) await knex('user_org_scopes').insert({ user_id: user.id, scope_type: 'ALL' });
  }
}
