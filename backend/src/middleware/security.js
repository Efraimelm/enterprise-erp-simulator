// Proteção contra CSRF para a API usada pelo navegador.
// 1) O cookie de sessão é SameSite=Strict (o navegador não o envia em requisições de outros sites).
// 2) Toda requisição que altera dados precisa do cabeçalho X-ERP-Client. Um formulário de outro
//    site não consegue enviar cabeçalhos personalizados sem CORS, e a API não libera CORS.
// 3) Se o navegador informar a origem (Origin), ela precisa ser a do próprio ERP.
import { config } from '../config.js';
import { forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.get('x-erp-client')) {
    throw forbidden('Requisição recusada: cabeçalho X-ERP-Client ausente.', 'CSRF_REJECTED');
  }
  const origin = req.get('origin');
  if (origin) {
    const allowed = new Set([config.frontendOrigin, `${req.protocol}://${req.get('host')}`]);
    if (!allowed.has(origin)) throw forbidden('Requisição recusada: origem não permitida.', 'CSRF_REJECTED');
  }
  next();
}
