import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { registerAuth } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { jobRoutes } from './routes/jobs.js';
import { battleRoutes } from './routes/battle.js';
import { itemRoutes } from './routes/items.js';
import { devRoutes } from './routes/dev.js';
import { DATA_VERSION, MAPS } from '@loce/shared';
import { attachRealtime } from '@loce/server-realtime';
import { pool } from './db/pool.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: config.corsOrigin });
await app.register(rateLimit, { max: config.devMode ? 2000 : 120, timeWindow: '1 minute' });
await registerAuth(app);

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) return reply.code(400).send({ code: 400, messageKey: 'error.validation', issues: err.issues });
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) req.log.error(err);
  const messageKey = err.message.startsWith('error.') ? err.message
    : status === 429 ? 'error.rateLimit'
    : status === 401 ? 'error.unauthorized'
    : 'error.internal';
  return reply.code(status).send({ code: status, messageKey });
});

app.get('/health', async () => ({ ok: true, dataVersion: DATA_VERSION, devMode: config.devMode }));

await app.register(authRoutes);
await app.register(meRoutes);
await app.register(jobRoutes);
await app.register(battleRoutes);
await app.register(itemRoutes);

// Rule 6 guard: Developer Mode routes never exist in release builds.
if (config.devMode) {
  await app.register(devRoutes);
  app.log.warn('DEV MODE ENABLED — do not use in production');
}

// Serve the built client from this server in production deploys (single service, no CORS)
if (config.serveClient) {
  const clientDist = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  await app.register(fastifyStatic, { root: clientDist });
  app.log.info(`serving client from ${clientDist}`);
}

await runMigrations(app.log);

// M2 (D-026): realtime presence hub shares this HTTP server — one deploy service, same origin WS.
attachRealtime({
  httpServer: app.server,
  verifyToken: (token) => {
    const payload = app.jwt.verify<{ accountId: number }>(token);
    return payload.accountId;
  },
  loadPlayer: async (accountId) => {
    const r = await pool.query(
      `SELECT a.display_name, s.current_job_id, s.current_map
       FROM accounts a JOIN account_state s ON s.account_id = a.id WHERE a.id = $1`,
      [accountId],
    );
    if (!r.rowCount) return null;
    return { name: r.rows[0].display_name, jobId: r.rows[0].current_job_id, mapId: r.rows[0].current_map };
  },
  log: { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) },
  validMaps: Object.keys(MAPS),
});

app.listen({ port: config.port, host: '0.0.0.0' })
  .then(() => app.log.info(`api up on :${config.port}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
