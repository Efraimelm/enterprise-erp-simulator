// Parâmetros gerais do sistema.
//   GET /api/settings        lista os parâmetros      (ADMIN.SETTINGS.READ)
//   PUT /api/settings/:key   altera um parâmetro      (ADMIN.SETTINGS.UPDATE) body: { "value": "..." }
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { requirePermission } from '../../middleware/auth.js';
import { settingDefinitions } from './definitions.js';

export const settingsRouter = Router();

settingsRouter.get('/', requirePermission('ADMIN.SETTINGS.READ'), async (req, res) => {
  const rows = await db('system_settings').select('setting_key', 'value', 'description', 'updated_at').orderBy('setting_key');
  res.json({
    data: rows.map((r) => ({
      ...r,
      label: settingDefinitions[r.setting_key]?.label ?? r.setting_key,
      options: settingDefinitions[r.setting_key]?.options ?? null,
    })),
  });
});

settingsRouter.put('/:key', requirePermission('ADMIN.SETTINGS.UPDATE'), async (req, res) => {
  const def = settingDefinitions[req.params.key];
  if (!def) throw notFound('Parâmetro não existe.');
  const { value } = z.object({ value: def.schema }).strict().parse(req.body);

  const row = await db.transaction(async (trx) => {
    const before = await trx('system_settings').where({ setting_key: req.params.key }).forUpdate().first();
    if (!before) throw notFound('Parâmetro não existe.');
    await trx('system_settings').where({ setting_key: req.params.key }).update({ value, updated_by: req.user.id });
    await audit(
      req,
      { action: 'UPDATE', entity: 'system_settings', entityId: req.params.key, result: 'SUCCESS', details: { de: before.value, para: value } },
      trx,
    );
    return trx('system_settings').where({ setting_key: req.params.key }).first('setting_key', 'value', 'description', 'updated_at');
  });
  res.json({ data: row });
});
