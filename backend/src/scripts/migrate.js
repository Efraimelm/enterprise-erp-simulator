// Uso: node src/scripts/migrate.js latest | rollback | reset | status
import { db } from '../db.js';
import { config } from '../config.js';

const command = process.argv[2] || 'latest';

try {
  if (command === 'latest') {
    const [batch, files] = await db.migrate.latest();
    console.log(files.length ? `Lote ${batch}: ${files.join(', ')}` : 'Banco já está na versão mais recente.');
  } else if (command === 'rollback') {
    const [batch, files] = await db.migrate.rollback();
    console.log(files.length ? `Desfeito o lote ${batch}: ${files.join(', ')}` : 'Nada para desfazer.');
  } else if (command === 'reset') {
    if (config.isProduction) throw new Error('reset é proibido em produção.');
    await db.migrate.rollback(undefined, true);
    const [, files] = await db.migrate.latest();
    console.log(`Banco ${config.db.database} recriado: ${files.length} migrations aplicadas.`);
  } else if (command === 'status') {
    const [done, pending] = await db.migrate.list();
    console.log('Aplicadas:', done.map((f) => f.name));
    console.log('Pendentes:', pending.map((f) => f.file));
  } else {
    throw new Error(`Comando desconhecido: ${command}`);
  }
} catch (err) {
  console.error('Erro na migration:', err.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
