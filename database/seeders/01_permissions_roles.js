// Permissões e roles da Etapa 1. As próximas etapas acrescentam as permissões de MM e SD.
// Idempotente: insere o que falta e atualiza descrições, sem apagar nada.

export const PERMISSIONS = [
  ['ADMIN.ORG.READ', 'ADMIN', 'Consultar a estrutura organizacional'],
  ['ADMIN.ORG.CREATE', 'ADMIN', 'Criar itens da estrutura organizacional'],
  ['ADMIN.ORG.UPDATE', 'ADMIN', 'Alterar itens da estrutura organizacional'],
  ['ADMIN.ORG.DELETE', 'ADMIN', 'Excluir itens da estrutura organizacional'],
  ['ADMIN.SETTINGS.READ', 'ADMIN', 'Consultar parâmetros gerais'],
  ['ADMIN.SETTINGS.UPDATE', 'ADMIN', 'Alterar parâmetros gerais'],
  ['ADMIN.AUDIT.READ', 'ADMIN', 'Consultar a trilha de auditoria'],
];

export const ROLES = [
  ['SAP_ADMIN', 'Administrador do ERP', 'Acesso total à administração do simulador', PERMISSIONS.map((p) => p[0])],
  ['AUDITOR', 'Auditor', 'Somente leitura da estrutura, dos parâmetros e da auditoria', ['ADMIN.ORG.READ', 'ADMIN.SETTINGS.READ', 'ADMIN.AUDIT.READ']],
];

export async function seed(knex) {
  await knex('permissions')
    .insert(PERMISSIONS.map(([code, module, description]) => ({ code, module, description })))
    .onConflict('code')
    .merge(['module', 'description']);

  await knex('roles')
    .insert(ROLES.map(([code, name, description]) => ({ code, name, description })))
    .onConflict('code')
    .merge(['name', 'description']);

  const permId = Object.fromEntries((await knex('permissions').select('id', 'code')).map((p) => [p.code, p.id]));
  const roleId = Object.fromEntries((await knex('roles').select('id', 'code')).map((r) => [r.code, r.id]));

  const links = ROLES.flatMap(([code, , , perms]) => perms.map((p) => ({ role_id: roleId[code], permission_id: permId[p] })));
  await knex('role_permissions').insert(links).onConflict(['role_id', 'permission_id']).ignore();
}
