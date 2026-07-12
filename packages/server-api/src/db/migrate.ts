/** Applies database/migrations/*.sql in order at server boot. Idempotent via _migrations table. */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import { pool } from './pool.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../database/migrations');

export async function runMigrations(log: FastifyBaseLogger) {
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const done = await client.query('SELECT 1 FROM _migrations WHERE name=$1', [f]);
      if (done.rowCount) continue;
      log.info(`migrating: ${f}`);
      await client.query('BEGIN');
      await client.query(await readFile(join(MIGRATIONS_DIR, f), 'utf8'));
      await client.query('INSERT INTO _migrations(name) VALUES($1)', [f]);
      await client.query('COMMIT');
    }
    log.info('database schema up to date');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
