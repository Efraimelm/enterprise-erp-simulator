// Parâmetros gerais aceitos pelo sistema e a regra de validação de cada um.
// Para criar um novo parâmetro: adicione aqui e no seeder database/seeders/04_system_settings.js.
import { z } from 'zod';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone').concat('UTC'));

export const settingDefinitions = {
  default_language: {
    label: 'Idioma padrão',
    schema: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Use o formato idioma-PAÍS, ex.: pt-BR.'),
  },
  default_timezone: {
    label: 'Fuso horário padrão',
    schema: z.string().refine((tz) => TIMEZONES.has(tz), 'Fuso horário inválido. Ex.: America/Sao_Paulo.'),
  },
  default_currency: {
    label: 'Moeda padrão',
    schema: z.string().regex(/^[A-Z]{3}$/, 'Use o código ISO de 3 letras, ex.: BRL.'),
  },
  date_format: {
    label: 'Formato de data',
    options: ['dd/MM/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy'],
    schema: z.enum(['dd/MM/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy'], { message: 'Formato não suportado.' }),
  },
  number_locale: {
    label: 'Formato de números',
    options: ['pt-BR', 'en-US'],
    schema: z.enum(['pt-BR', 'en-US'], { message: 'Formato não suportado.' }),
  },
};
