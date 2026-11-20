// Relatórios de BI.
//   GET /api/reports                       lista os relatórios que o usuário pode ver
//   GET /api/reports/:name                 { from?, to?, plant_id?, group?=day|month, page?, pageSize?, all?=true, format?=csv, decimal?=comma|dot }
import { Router } from 'express';
import { z } from 'zod';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { assertPlant, zDate, zId } from '../mm/common.js';
import { toCsv } from './csv.js';
import { REPORTS } from './reports.js';

const MAX_ALL = 20_000;
const iso = (d) => d.toISOString().slice(0, 10);

const querySchema = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  plant_id: zId.optional(),
  group: z.enum(['day', 'month']).default('month'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  all: z.enum(['true', 'false']).optional(),
  format: z.enum(['json', 'csv']).default('json'),
  decimal: z.enum(['comma', 'dot']).default('comma'),
});

export const reportsRouter = Router();

reportsRouter.get('/', requireAuth, (req, res) => {
  res.json({
    data: Object.entries(REPORTS)
      .filter(([, r]) => req.user.permissions.has(r.permission))
      .map(([name, r]) => ({ name, title: r.title, group: r.group, period: r.period, definition: r.definition, columns: r.columns })),
  });
});

reportsRouter.get('/:name', requireAuth, async (req, res) => {
  const report = REPORTS[req.params.name];
  if (!report) throw notFound('Relatório não encontrado.');
  if (req.user.must_change_password) throw forbidden('Troque sua senha antes de continuar.', 'PASSWORD_CHANGE_REQUIRED');
  if (!req.user.permissions.has(report.permission)) throw forbidden(`Você não tem a permissão ${report.permission}.`);
  const f = querySchema.parse(req.query);
  if (f.plant_id) await assertPlant(req, f.plant_id);
  const to = f.to ?? iso(new Date());
  const from = f.from ?? iso(new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86400_000));
  if (from > to) throw badRequest('A data inicial deve ser anterior ou igual à final.', [{ field: 'from', message: 'Período inválido.' }]);
  if ((Date.parse(to) - Date.parse(from)) / 86400_000 > 366) throw badRequest('Período máximo de 366 dias.', [{ field: 'from', message: 'Reduza o período.' }]);

  const filters = { ...f, from, to };
  const { rows, totals } = await report.run(req, filters);
  const meta = {
    report: req.params.name, title: report.title, definition: report.definition, generated_at: new Date().toISOString(),
    filters: { ...(report.period ? { from, to } : {}), plant_id: f.plant_id ?? null, ...(req.params.name === 'sales-by-period' ? { group: f.group } : {}) },
    scope: req.user.scope.all ? 'todos os centros' : `centros ${[...req.user.scope.plantIds].join(', ')}`,
  };

  if (f.format === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${req.params.name}-${stamp}.csv"`);
    return res.send(toCsv(report.columns, rows, { decimal: f.decimal }));
  }
  if (f.all === 'true') {
    if (rows.length > MAX_ALL) throw badRequest(`O relatório tem ${rows.length} linhas (máximo ${MAX_ALL} com all=true). Filtre por centro ou período.`);
    return res.json({ data: rows, totals, columns: report.columns, meta, total: rows.length });
  }
  const start = (f.page - 1) * f.pageSize;
  res.json({ data: rows.slice(start, start + f.pageSize), totals, columns: report.columns, meta, page: f.page, pageSize: f.pageSize, total: rows.length });
});
