// Sessão, autenticação e autorização.
// - loadSession: lê o cookie, busca a sessão válida e coloca o usuário em req.user
// - requireAuth: exige usuário logado
// - requirePermission: exige uma permissão específica (validada sempre no backend)
import crypto from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { loadScope } from '../lib/scope.js';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function loadUserContext(userId) {
  const user = await db('users')
    .where({ id: userId })
    .first('id', 'username', 'full_name', 'email', 'status', 'must_change_password');
  if (!user) return null;
  const roles = await db('user_roles as ur')
    .join('roles as r', 'r.id', 'ur.role_id')
    .where('ur.user_id', userId)
    .pluck('r.code');
  const permissions = await db('user_roles as ur')
    .join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('ur.user_id', userId)
    .distinct()
    .pluck('p.code');
  const scope = await loadScope(userId);
  return { ...user, must_change_password: !!user.must_change_password, roles, permissions: new Set(permissions), scope };
}

/** Registra na auditoria e recusa um acesso fora do escopo organizacional do usuário. */
export async function denyOutOfScope(req, details) {
  await audit(req, { action: 'ACCESS', entity: req.baseUrl + req.path, result: 'DENIED', details: { method: req.method, motivo: 'fora do escopo', ...details } });
  return forbidden('Este registro está fora do seu escopo organizacional (empresas e centros liberados para você).', 'OUT_OF_SCOPE');
}

export async function loadSession(req, res, next) {
  const token = req.cookies?.[config.session.cookieName];
  if (!token || token.length > 100) return next();
  const session = await db('sessions')
    .where({ token_hash: hashToken(token) })
    .andWhere('expires_at', '>', db.fn.now())
    .first('id', 'user_id');
  if (!session) return next();
  const user = await loadUserContext(session.user_id);
  if (!user || user.status !== 'ACTIVE') return next();
  req.user = user;
  req.sessionId = session.id;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) throw unauthorized();
  next();
}

export function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.user) throw unauthorized();
    if (req.user.must_change_password) {
      throw forbidden('Troque sua senha antes de continuar.', 'PASSWORD_CHANGE_REQUIRED');
    }
    if (!req.user.permissions.has(permission)) {
      await audit(req, {
        action: 'ACCESS',
        entity: req.baseUrl + req.path,
        result: 'DENIED',
        details: { method: req.method, permission },
      });
      throw forbidden(`Você não tem a permissão ${permission}.`);
    }
    next();
  };
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    email: user.email,
    roles: user.roles,
    permissions: [...user.permissions].sort(),
    scopes: user.scope.entries,
    must_change_password: user.must_change_password,
  };
}
