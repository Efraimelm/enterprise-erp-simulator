// Login, logout, usuário atual e troca de senha.
import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../../db.js';
import { config } from '../../config.js';
import { audit } from '../../lib/audit.js';
import { HttpError, badRequest, forbidden } from '../../lib/errors.js';
import { hashPassword, passwordPolicyErrors, verifyAgainstDummy, verifyPassword } from '../../lib/password.js';
import { hashToken, loadUserContext, publicUser, requireAuth } from '../../middleware/auth.js';

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Informe o usuário.').max(40),
  password: z.string().min(1, 'Informe a senha.').max(128),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Informe a senha atual.').max(128),
  new_password: z.string().max(128),
});

const invalidCredentials = () => new HttpError(401, 'INVALID_CREDENTIALS', 'Usuário ou senha inválidos.');

export function authRouter({ loginRateLimit = config.login.rateLimit } = {}) {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) =>
      res.status(429).json({
        error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas de login. Aguarde alguns minutos.' },
      }),
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await db('users').where({ username }).first();

    // Usuário técnico (cliente de integração) não entra pela tela: responde como usuário inexistente.
    if (!user || user.is_technical) {
      await verifyAgainstDummy(password);
      await audit(req, { action: 'LOGIN', result: 'FAILURE', details: { username, motivo: 'usuário inexistente' } });
      throw invalidCredentials();
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await audit(req, { action: 'LOGIN', result: 'DENIED', user, details: { motivo: 'conta bloqueada temporariamente' } });
      throw new HttpError(
        423,
        'ACCOUNT_LOCKED',
        `Conta bloqueada temporariamente por excesso de tentativas. Tente de novo em até ${config.login.lockMinutes} minutos.`,
      );
    }

    if (!(await verifyPassword(user.password_hash, password))) {
      const failed = user.failed_attempts + 1;
      const lock = failed >= config.login.maxFailedAttempts;
      await db('users')
        .where({ id: user.id })
        .update({
          failed_attempts: lock ? 0 : failed,
          locked_until: lock ? new Date(Date.now() + config.login.lockMinutes * 60_000) : null,
        });
      await audit(req, {
        action: 'LOGIN',
        result: 'FAILURE',
        user,
        details: { motivo: 'senha incorreta', tentativa: failed, bloqueou: lock },
      });
      throw invalidCredentials();
    }

    if (user.status !== 'ACTIVE') {
      await audit(req, { action: 'LOGIN', result: 'DENIED', user, details: { motivo: `usuário ${user.status}` } });
      throw forbidden('Usuário bloqueado ou inativo. Procure o administrador.', 'USER_BLOCKED');
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const ttlMs = config.session.ttlHours * 3600_000;
    await db.transaction(async (trx) => {
      await trx('users').where({ id: user.id }).update({ failed_attempts: 0, locked_until: null, last_login_at: new Date() });
      await trx('sessions').where('user_id', user.id).andWhere('expires_at', '<', trx.fn.now()).del();
      await trx('sessions').insert({
        token_hash: hashToken(token),
        user_id: user.id,
        expires_at: new Date(Date.now() + ttlMs),
        ip: req.ip,
        user_agent: (req.get('user-agent') || '').slice(0, 255),
      });
      await audit(req, { action: 'LOGIN', result: 'SUCCESS', user }, trx);
    });

    res.cookie(config.session.cookieName, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.isProduction,
      path: '/',
      maxAge: ttlMs,
    });
    res.json({ user: publicUser(await loadUserContext(user.id)) });
  });

  router.post('/logout', async (req, res) => {
    if (req.sessionId) {
      await db('sessions').where({ id: req.sessionId }).del();
      await audit(req, { action: 'LOGOUT', result: 'SUCCESS' });
    }
    res.clearCookie(config.session.cookieName, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    const body = changePasswordSchema.parse(req.body);
    const user = await db('users').where({ id: req.user.id }).first();

    if (!(await verifyPassword(user.password_hash, body.current_password))) {
      await audit(req, { action: 'CHANGE_PASSWORD', entity: 'users', entityId: user.id, result: 'FAILURE', details: { motivo: 'senha atual incorreta' } });
      throw badRequest('A senha atual está incorreta.', [{ field: 'current_password', message: 'Senha atual incorreta.' }]);
    }
    const problems = passwordPolicyErrors(body.new_password, { username: user.username });
    if (body.new_password === body.current_password) problems.push('A nova senha precisa ser diferente da atual.');
    if (problems.length) {
      throw badRequest('A nova senha não atende à política.', problems.map((message) => ({ field: 'new_password', message })));
    }

    await db.transaction(async (trx) => {
      await trx('users')
        .where({ id: user.id })
        .update({ password_hash: await hashPassword(body.new_password), must_change_password: false, password_changed_at: new Date() });
      // Encerra as outras sessões abertas desse usuário.
      await trx('sessions').where('user_id', user.id).whereNot('id', req.sessionId).del();
      await audit(req, { action: 'CHANGE_PASSWORD', entity: 'users', entityId: user.id, result: 'SUCCESS' }, trx);
    });

    res.json({ user: publicUser(await loadUserContext(user.id)) });
  });

  return router;
}
