// Converte qualquer erro numa resposta JSON padronizada, sem expor detalhes internos.
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const MYSQL_ERRORS = {
  ER_DUP_ENTRY: [409, 'DUPLICATE', 'Já existe um registro com esse código ou combinação.'],
  ER_NO_REFERENCED_ROW_2: [422, 'INVALID_REFERENCE', 'Um dos registros vinculados não existe.'],
  ER_ROW_IS_REFERENCED_2: [
    409,
    'IN_USE',
    'Não é possível excluir: existem registros vinculados a este. Inative em vez de excluir.',
  ],
};

export function zodDetails(err) {
  return err.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message }));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Dados inválidos.', details: zodDetails(err) } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON inválido.' } });
  }
  if (MYSQL_ERRORS[err.code]) {
    const [status, code, message] = MYSQL_ERRORS[err.code];
    return res.status(status).json({ error: { code, message } });
  }
  logger.error('unhandled_error', { path: req.path, method: req.method, error: err.message, stack: err.stack });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente.' } });
}
