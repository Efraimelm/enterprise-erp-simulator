// Conexão única com o banco (pool do Knex + driver mysql2).
// Todas as datas são gravadas e lidas em UTC; a tela converte para o fuso do usuário.
import path from 'node:path';
import knexLib from 'knex';
import { config, rootDir } from './config.js';

export const knexConfig = {
  client: 'mysql2',
  connection: {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    timezone: 'Z',
    charset: 'utf8mb4',
    decimalNumbers: true,
    // Colunas DATE (ex.: data de entrega) chegam como texto 'AAAA-MM-DD', sem conversão de fuso.
    typeCast(field, next) {
      return field.type === 'DATE' ? field.string() : next();
    },
  },
  pool: {
    min: 0,
    max: 10,
    afterCreate(conn, done) {
      conn.query("SET time_zone = '+00:00'", (err) => done(err, conn));
    },
  },
  migrations: {
    directory: path.join(rootDir, 'database', 'migrations'),
    tableName: 'knex_migrations',
    loadExtensions: ['.js'],
  },
  seeds: {
    directory: path.join(rootDir, 'database', 'seeders'),
    loadExtensions: ['.js'],
  },
};

export const db = knexLib(knexConfig);
