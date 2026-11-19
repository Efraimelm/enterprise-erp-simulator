// Carrega os dados iniciais (permissões, roles, empresa de demonstração e usuários).
// Os seeders são idempotentes: rodar de novo não duplica nem apaga nada.
import { db } from '../db.js';
import { config } from '../config.js';

try {
  const [files] = await db.seed.run();
  console.log(`Seeds aplicados em ${config.db.database}: ${files.map((f) => f.split(/[\\/]/).pop()).join(', ')}`);
} catch (err) {
  console.error('Erro no seed:', err.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
