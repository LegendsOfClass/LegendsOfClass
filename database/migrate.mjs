// Minimal migration runner: applies database/migrations/*.sql in order, tracked in _migrations.
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://loce:loce@localhost:5432/loce' });
const client = await pool.connect();
try {
  await client.query('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await client.query('SELECT 1 FROM _migrations WHERE name=$1', [f]);
    if (done.rowCount) continue;
    console.log('applying', f);
    await client.query('BEGIN');
    await client.query(await readFile(join(dir, f), 'utf8'));
    await client.query('INSERT INTO _migrations(name) VALUES($1)', [f]);
    await client.query('COMMIT');
  }
  console.log('migrations up to date');
} catch (e) { await client.query('ROLLBACK'); throw e; }
finally { client.release(); await pool.end(); }
