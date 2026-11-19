// Antes de todos os testes: recria o banco erp_test do zero (migrations + seeds).
// Os testes nunca tocam no banco de desenvolvimento (erp_dev).
export default async function setup() {
  process.env.NODE_ENV = 'test';
  const { db } = await import('../src/db.js');
  const { config } = await import('../src/config.js');
  if (!config.db.database.includes('test')) throw new Error(`Banco de teste inesperado: ${config.db.database}`);

  await db.raw('SET FOREIGN_KEY_CHECKS=0');
  const [tables] = await db.raw('SHOW TABLES');
  for (const row of tables) await db.schema.dropTable(Object.values(row)[0]);
  await db.raw('SET FOREIGN_KEY_CHECKS=1');

  await db.migrate.latest();
  await db.seed.run();
  await db.destroy();
}
