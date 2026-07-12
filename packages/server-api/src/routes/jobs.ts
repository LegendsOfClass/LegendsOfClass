import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '../db/pool.js';
import { JOBS, GAME, SKILLS } from '@loce/shared';
import { grantSkillUnlocks, type JobRow } from '../services/accountService.js';
import { httpError } from '../services/battleService.js';

export async function jobRoutes(app: FastifyInstance) {
  /** Switch job. Tier-1 picks are free at the Job Master (D-001): first switch auto-unlocks the job row. */
  app.post('/jobs/switch', { onRequest: [app.authenticate] }, async (req) => {
    const { jobId } = z.object({ jobId: z.string() }).parse(req.body);
    const def = JOBS[jobId];
    if (!def) throw httpError(400, 'error.job.unknown');
    return tx(async (c) => {
      const state = await c.query('SELECT current_map FROM account_state WHERE account_id=$1 FOR UPDATE', [req.user.accountId]);
      if (state.rows[0].current_map !== 'town') throw httpError(400, 'error.job.townOnly'); // docs/02-jobs-skills/01
      if (def.tier > 1) throw httpError(400, 'error.job.locked'); // Fusion arrives in M4
      await c.query(
        'INSERT INTO jobs(account_id, job_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [req.user.accountId, jobId],
      );
      const jobRow = (await c.query('SELECT * FROM jobs WHERE account_id=$1 AND job_id=$2', [req.user.accountId, jobId])).rows[0] as JobRow;
      await grantSkillUnlocks(c, req.user.accountId, jobId, jobRow.level, SKILLS as never);
      await c.query('UPDATE account_state SET current_job_id=$2 WHERE account_id=$1', [req.user.accountId, jobId]);
      return { ok: true, jobId };
    });
  });

  /** Allocate stat points for the CURRENT job (D-023 per-job pools). Deltas must be >= 0 (respec = M-later). */
  app.post('/jobs/allocate', { onRequest: [app.authenticate] }, async (req) => {
    const body = z.object({
      str: z.number().int().min(0).max(500), dex: z.number().int().min(0).max(500),
      con: z.number().int().min(0).max(500), int: z.number().int().min(0).max(500),
    }).parse(req.body);
    const total = body.str + body.dex + body.con + body.int;
    if (total === 0) throw httpError(400, 'error.stats.empty');
    return tx(async (c) => {
      const state = await c.query('SELECT current_job_id FROM account_state WHERE account_id=$1', [req.user.accountId]);
      const jobId = state.rows[0].current_job_id;
      const r = await c.query(
        `UPDATE jobs SET stat_str=stat_str+$3, stat_dex=stat_dex+$4, stat_con=stat_con+$5, stat_int=stat_int+$6,
         unspent_points=unspent_points-$7
         WHERE account_id=$1 AND job_id=$2 AND unspent_points>=$7 RETURNING unspent_points`,
        [req.user.accountId, jobId, body.str, body.dex, body.con, body.int, total],
      );
      if (!r.rowCount) throw httpError(400, 'error.stats.insufficient');
      return { ok: true, unspentPoints: r.rows[0].unspent_points };
    });
  });

  /** Travel between maps (M1: town <-> grassland). */
  app.post('/travel', { onRequest: [app.authenticate] }, async (req) => {
    const { mapId } = z.object({ mapId: z.enum(['town', 'grassland']) }).parse(req.body);
    return tx(async (c) => {
      await c.query('UPDATE account_state SET current_map=$2 WHERE account_id=$1', [req.user.accountId, mapId]);
      return { ok: true, mapId };
    });
  });
}
