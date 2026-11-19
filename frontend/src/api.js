// Cliente da API. Envia sempre o cabeçalho X-ERP-Client (exigido pelo backend contra CSRF)
// e transforma respostas de erro em ApiError com a mensagem e os erros por campo.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Erro ${status}`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details || [];
  }

  /** { campo: 'mensagem' } para mostrar embaixo de cada campo do formulário. */
  get fieldErrors() {
    return Object.fromEntries(this.details.filter((d) => d.field).map((d) => [d.field, d.message]));
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'X-ERP-Client': 'web', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { message: 'Sem conexão com o servidor. O backend está rodando?' } });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('erp:unauthorized'));
    throw new ApiError(res.status, data);
  }
  return data;
}

export const toQuery = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};
