// Erro de negócio com código HTTP. Lançar um HttpError em qualquer rota gera uma resposta
// no formato padrão: { error: { code, message, details? } }
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Faça login para continuar.') => new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Você não tem permissão para esta operação.', code = 'FORBIDDEN') =>
  new HttpError(403, code, message);
export const notFound = (message = 'Registro não encontrado.') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message) => new HttpError(409, 'CONFLICT', message);
