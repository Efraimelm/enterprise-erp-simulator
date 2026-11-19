// Consulta da trilha de auditoria (somente leitura).
//   GET /api/audit?page=&pageSize=&username=&action=&entity=&result=&from=&to=   (ADMIN.AUDIT.READ)
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { requirePermission } from '../../middleware/auth.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  username: z.string().trim().max(40).optional(),
  action: z.string().trim().max(40).optional(),
  entity: z.string().trim().max(60).optional(),
  result: z.enum(['SUCCESS', 'DENIED', 'FAILURE']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const auditRouter = Router();

auditRouter.get('/', requirePermission('ADMIN.AUDIT.READ'), async (req, res) => {
  const f = querySchema.parse(req.query);
  const base = db('audit_logs').where((qb) => {
    if (f.username) qb.where('username', f.username.toLowerCase());
    if (f.action) qb.where('action', f.action.toUpperCase());
    if (f.entity) qb.where('entity', 'like', `${f.entity}%`);
    if (f.result) qb.where('result', f.result);
    if (f.from) qb.where('occurred_at', '>=', f.from);
    if (f.to) qb.where('occurred_at', '<=', f.to);
  });
  const [{ total }] = await base.clone().count({ total: '*' });
  const rows = await base
    .clone()
    .select('id', 'occurred_at', 'username', 'action', 'entity', 'entity_id', 'result', 'ip', 'details')
    .orderBy('id', 'desc')
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);

  res.json({
    data: rows.map((r) => ({ ...r, details: typeof r.details === 'string' ? JSON.parse(r.details) : r.details })),
    page: f.page,
    pageSize: f.pageSize,
    total: Number(total),
  });
});
