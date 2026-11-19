// Monta a aplicação Express. Separado do server.js para os testes usarem a app sem abrir porta.
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { db } from './db.js';
import { config } from './config.js';
import { requestLogger } from './lib/logger.js';
import { loadSession } from './middleware/auth.js';
import { csrfProtection } from './middleware/security.js';
import { errorHandler } from './middleware/errors.js';
import { authRouter } from './modules/auth/routes.js';
import { orgRouter } from './modules/org/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { auditRouter } from './modules/audit/routes.js';
import { usersRouter } from './modules/admin/users.js';
import { rolesRouter } from './modules/admin/roles.js';
import { masterDataRouter } from './modules/mm/master-data.js';
import { stockRouter } from './modules/mm/stock.js';
import { purchasingRouter } from './modules/mm/purchasing.js';
import { goodsReceiptsRouter } from './modules/mm/goods-receipts.js';
import { mrpRouter } from './modules/mm/mrp.js';
import { sdMasterRouter } from './modules/sd/master-data.js';
import { salesOrdersRouter } from './modules/sd/sales-orders.js';
import { deliveriesRouter } from './modules/sd/deliveries.js';
import { billingRouter } from './modules/sd/billing.js';
import { flowRouter } from './modules/flow/flow.js';

export function createApp({ loginRateLimit = config.login.rateLimit } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(requestLogger);

  app.get('/api/health', async (req, res) => {
    await db.raw('select 1');
    res.json({ status: 'ok', database: 'ok', environment: config.env, time: new Date().toISOString() });
  });

  app.use('/api', csrfProtection);
  app.use('/api', loadSession);
  app.use('/api/auth', authRouter({ loginRateLimit }));
  app.use('/api/org', orgRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/admin/users', usersRouter);
  app.use('/api/admin', rolesRouter);
  app.use('/api/mm', masterDataRouter, stockRouter, purchasingRouter, goodsReceiptsRouter, mrpRouter);
  app.use('/api/sd', sdMasterRouter, salesOrdersRouter, deliveriesRouter, billingRouter);
  app.use('/api/flow', flowRouter);

  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }));
  app.use(errorHandler);
  return app;
}
