import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { pool, tx } from '../db/pool.js';
import { createAccount } from '../services/accountService.js';
import { config } from '../config.js';

const credentials = z.object({
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
});
const registerBody = credentials.extend({ displayName: z.string().min(2).max(20).trim() });

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', { config: { rateLimit: { max: config.devMode ? 300 : 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = registerBody.parse(req.body);
    const hash = await argon2.hash(body.password, { type: argon2.argon2id, memoryCost: 65536 });
    try {
      const accountId = await tx((c) => createAccount(c, body.username.toLowerCase(), body.displayName, hash));
      return { token: app.jwt.sign({ accountId }) };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return reply.code(409).send({ code: 409, messageKey: 'error.auth.taken' });
      throw e;
    }
  });

  app.post('/auth/login', { config: { rateLimit: { max: config.devMode ? 600 : 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = credentials.parse(req.body);
    const r = await pool.query('SELECT id, password_hash, status FROM accounts WHERE username=$1', [body.username.toLowerCase()]);
    // Generic error either way — no username enumeration (docs/08-technical/04)
    if (!r.rowCount || r.rows[0].status !== 'active' || !(await argon2.verify(r.rows[0].password_hash, body.password))) {
      return reply.code(401).send({ code: 401, messageKey: 'error.auth.invalid' });
    }
    await pool.query('UPDATE accounts SET last_login_at=now() WHERE id=$1', [r.rows[0].id]);
    return { token: app.jwt.sign({ accountId: r.rows[0].id }) };
  });
}
