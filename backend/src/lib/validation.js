// Monta o schema Zod de uma entidade a partir da lista de campos (ver modules/org/entities.js).
import { z } from 'zod';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone').concat('UTC'));
const UF = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

function baseSchema(f) {
  const str = () => z.string({ invalid_type_error: 'Deve ser um texto.' }).trim();
  switch (f.type) {
    case 'code':
      return str()
        .toUpperCase()
        .regex(new RegExp(`^[A-Z0-9]{1,${f.maxLength}}$`), `Use de 1 a ${f.maxLength} letras ou números, sem espaços.`);
    case 'text':
      return str().min(1, 'Campo obrigatório.').max(f.maxLength, `Máximo de ${f.maxLength} caracteres.`);
    case 'email':
      return str().email('E-mail inválido.').max(f.maxLength ?? 160);
    case 'country':
      return str().toUpperCase().regex(/^[A-Z]{2}$/, 'Use o código ISO de 2 letras, ex.: BR.');
    case 'currency':
      return str().toUpperCase().regex(/^[A-Z]{3}$/, 'Use o código ISO de 3 letras, ex.: BRL.');
    case 'language':
      return str().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use o formato idioma-PAÍS, ex.: pt-BR.');
    case 'timezone':
      return str().refine((tz) => TIMEZONES.has(tz), 'Fuso horário inválido. Ex.: America/Sao_Paulo.');
    case 'uf':
      return str().toUpperCase().refine((uf) => UF.has(uf), 'UF inválida. Ex.: SP.');
    case 'ref':
      return z.coerce.number({ invalid_type_error: 'Selecione um registro.' }).int().positive('Selecione um registro.');
    case 'boolean':
      return z.boolean({ invalid_type_error: 'Deve ser verdadeiro ou falso.' });
    default:
      throw new Error(`Tipo de campo desconhecido: ${f.type}`);
  }
}

export function buildEntitySchema(fields) {
  const shape = {};
  for (const f of fields) {
    let s = baseSchema(f);
    if (f.type === 'boolean') s = s.default(f.default ?? false);
    // Obrigatório: ausente/nulo vira '' e cai na mensagem do próprio tipo (ex.: "Campo obrigatório.").
    else if (f.required) s = z.preprocess((v) => (v == null ? '' : v), s);
    else s = z.preprocess(emptyToNull, s.nullable().optional()).transform((v) => v ?? null);
    shape[f.name] = s;
  }
  return z.object(shape).strict();
}

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(80).optional(),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});
