import pg from 'pg';
pg.types.setTypeParser(20, (v) => Number(v)); // BIGINT → number (all game values < 2^53 by design caps)
import { config } from '../config.js';

// Cloud PostgreSQL (e.g. Neon) requires TLS; local docker/postgres does not.
const needSsl = /sslmode=require|neon\.tech/.test(config.databaseUrl);
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  ssl: needSsl ? { rejectUnauthorized: false } : undefined,
});

/** Run fn inside a transaction; commits on success, rolls back on throw. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
