import { createApp } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { logger } from './lib/logger.js';

try {
  await db.raw('select 1');
} catch (err) {
  console.error(`Não consegui conectar no banco ${config.db.host}:${config.db.port} (${err.code || err.message}).`);
  console.error('Ligue o banco com "npm run db:start" e tente de novo.');
  process.exit(1);
}

const [, pending] = await db.migrate.list();
if (pending.length) {
  console.error(`Existem ${pending.length} migrations pendentes. Rode "npm run migrate".`);
  process.exit(1);
}

const server = createApp().listen(config.port, '127.0.0.1', () => {
  logger.info('server_started', { url: `http://localhost:${config.port}`, database: config.db.database });
});

const shutdown = () => server.close(() => db.destroy().then(() => process.exit(0)));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
