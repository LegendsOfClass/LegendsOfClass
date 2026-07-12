/**
 * Rule 6 — Developer Mode.
 * These routes are mounted ONLY when config.devMode is true (see index.ts guard).
 * config.devMode is hard-false when NODE_ENV === 'production'.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '../db/pool.js';
import { GAME, JOBS, MONSTERS, SKILLS, applyExp } from '@loce/shared';
import { addCurrency, grantSkillUnlocks, type JobRow } from '../services/accountService.js';
import { devFlags } from '../services/devService.js';
import { httpError } from '../services/battleService.js';

export async function devRoutes(app: FastifyInstance) {
  // 1. Give EXP (applies level-ups + skill unlocks through the normal pipeline)
  app.post('/dev/give-exp', { onRequest: [app.authenticate] }, async (req) => {
    const { amount } = z.object({ amount: z.number().int().min(1).max(10_000_000) }).parse(req.body);
    return tx(async (c) => {
      const state = await c.query('SELECT current_job_id FROM account_state WHERE account_id=$1', [req.user.accountId]);
      const jobId = state.rows[0].current_job_id;
      const jobRow = (await c.query('SELECT * FROM jobs WHERE account_id=$1 AND job_id=$2 FOR UPDATE', [req.user.accountId, jobId])).rows[0] as JobRow;
      const a = applyExp(jobRow.level, jobRow.exp, amount);
      await c.query('UPDATE jobs SET level=$3, exp=$4, unspent_points=unspent_points+$5 WHERE account_id=$1 AND job_id=$2',
        [req.user.accountId, jobId, a.level, a.exp, a.statPointsGained]);
      await grantSkillUnlocks(c, req.user.accountId, jobId, a.level, SKILLS as never);
      return { ok: true, level: a.level, levelsGained: a.levelsGained };
    });
  });

  // 2. Give Gold
  app.post('/dev/give-gold', { onRequest: [app.authenticate] }, async (req) => {
    const { amount } = z.object({ amount: z.number().int().min(1).max(100_000_000) }).parse(req.body);
    return tx(async (c) => ({ ok: true, gold: await addCurrency(c, req.user.accountId, 'gold', amount, 'dev') }));
  });

  // 3. Unlock Job (any tier, bypasses fusion for testing)
  app.post('/dev/unlock-job', { onRequest: [app.authenticate] }, async (req) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(req.body);
    if (!JOBS[jobId]) throw httpError(400, 'error.job.unknown');
    return tx(async (c) => {
      await c.query('INSERT INTO jobs(account_id, job_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.user.accountId, jobId]);
      return { ok: true, jobId };
    });
  });

  // 4. Spawn Monster — returns valid nodeIds so the client can start any fight
  app.get('/dev/monsters', { onRequest: [app.authenticate] }, async () => ({ monsters: Object.keys(MONSTERS) }));

  // 5. Teleport
  app.post('/dev/teleport', { onRequest: [app.authenticate] }, async (req) => {
    const { mapId } = z.object({ mapId: z.string() }).parse(req.body);
    return tx(async (c) => {
      await c.query('UPDATE account_state SET current_map=$2 WHERE account_id=$1', [req.user.accountId, mapId]);
      return { ok: true, mapId };
    });
  });

  // 6. God Mode (per-account, in-memory, dev-only)
  app.post('/dev/god', { onRequest: [app.authenticate] }, async (req) => {
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    devFlags.set(req.user.accountId, { ...devFlags.get(req.user.accountId), god: on });
    return { ok: true, god: on };
  });

  // 7. Reset Save (wipes progress, recreates fresh Novice state)
  app.post('/dev/reset', { onRequest: [app.authenticate] }, async (req) => {
    return tx(async (c) => {
      const id = req.user.accountId;
      await c.query('DELETE FROM jobs WHERE account_id=$1', [id]);
      await c.query('DELETE FROM items WHERE account_id=$1', [id]);
      await c.query('DELETE FROM skills_unlocked WHERE account_id=$1', [id]);
      await c.query('DELETE FROM battles WHERE account_id=$1', [id]);
      await c.query('DELETE FROM transactions WHERE account_id=$1', [id]);
      const cur = await c.query('SELECT current_job_id FROM account_state WHERE account_id=$1', [id]);
      const keepJob = cur.rows[0]?.current_job_id ?? 'swordman';
      await c.query(`UPDATE account_state SET gold=0, diamond=0, current_map='town', tutorial_flags='{}' WHERE account_id=$1`, [id]);
      await c.query('INSERT INTO jobs(account_id, job_id) VALUES($1,$2)', [id, keepJob]);
      await addCurrency(c, id, 'diamond', 1000, 'starter');
      devFlags.delete(id);
      return { ok: true };
    });
  });
}
