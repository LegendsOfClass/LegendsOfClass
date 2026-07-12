import type { PoolClient } from 'pg';
import { pool, tx } from '../db/pool.js';
import { JOBS, ITEMS, type PrimaryStats, type GearBonus } from '@loce/shared';

export interface JobRow {
  job_id: string; level: number; exp: number; rebirth_count: number;
  stat_str: number; stat_dex: number; stat_con: number; stat_int: number;
  unspent_points: number;
}
export interface ItemRow { id: number; item_id: string; rarity: string; enhance_level: number; equipped_slot: string | null; }

export async function createAccount(c: PoolClient, username: string, displayName: string, passwordHash: string) {
  const acc = await c.query(
    'INSERT INTO accounts(username, display_name, password_hash) VALUES($1,$2,$3) RETURNING id',
    [username, displayName, passwordHash],
  );
  const id: number = acc.rows[0].id;
  await c.query('INSERT INTO account_state(account_id) VALUES($1)', [id]);
  await c.query(
    `INSERT INTO jobs(account_id, job_id) VALUES($1,'novice')`, [id],
  );
  await addCurrency(c, id, 'diamond', 1000, 'starter'); // docs/07-economy: test currency for new players
  return id;
}

export async function loadProfile(accountId: number) {
  const [acc, state, jobs, items, skills] = await Promise.all([
    pool.query('SELECT id, username, display_name FROM accounts WHERE id=$1', [accountId]),
    pool.query('SELECT * FROM account_state WHERE account_id=$1', [accountId]),
    pool.query('SELECT * FROM jobs WHERE account_id=$1', [accountId]),
    pool.query('SELECT id, item_id, rarity, enhance_level, equipped_slot FROM items WHERE account_id=$1 ORDER BY id', [accountId]),
    pool.query('SELECT skill_id FROM skills_unlocked WHERE account_id=$1', [accountId]),
  ]);
  if (!acc.rowCount) return null;
  return {
    account: acc.rows[0],
    state: state.rows[0],
    jobs: jobs.rows as JobRow[],
    items: items.rows as ItemRow[],
    skillsUnlocked: skills.rows.map((r: { skill_id: string }) => r.skill_id),
  };
}

/** Total primary stats for a job row = config base + allocated points (D-023). */
export function primaryStatsFor(jobRow: JobRow): PrimaryStats {
  const base = JOBS[jobRow.job_id]?.base;
  if (!base) throw new Error(`Unknown job ${jobRow.job_id}`);
  return {
    str: base.str + jobRow.stat_str,
    dex: base.dex + jobRow.stat_dex,
    con: base.con + jobRow.stat_con,
    int: base.int + jobRow.stat_int,
  };
}

/** Sum equipped gear bonuses with rarity + enhancement multipliers (docs/04-items/01-02). */
export function gearBonusFor(items: ItemRow[], rarityMult: Record<string, number>): GearBonus {
  const total: Required<GearBonus> = { patk: 0, matk: 0, def: 0, hp: 0, spd: 0 };
  for (const it of items) {
    if (!it.equipped_slot) continue;
    const def = ITEMS[it.item_id];
    if (!def) continue;
    const mult = (rarityMult[it.rarity] ?? 1) * (1 + 0.05 * it.enhance_level);
    total.patk += Math.floor((def.stats.patk ?? 0) * mult);
    total.matk += Math.floor((def.stats.matk ?? 0) * mult);
    total.def += Math.floor((def.stats.def ?? 0) * mult);
    total.hp += Math.floor((def.stats.hp ?? 0) * mult);
    total.spd += Math.floor((def.stats.spd ?? 0) * mult);
  }
  return total;
}

/** Ledger-based currency mutation (docs/07-economy/01). Throws on insufficient funds via CHECK. */
export async function addCurrency(c: PoolClient, accountId: number, currency: 'gold' | 'diamond', delta: number, reason: string, refId?: string) {
  const r = await c.query(
    `UPDATE account_state SET ${currency} = ${currency} + $2 WHERE account_id=$1 RETURNING ${currency} AS bal`,
    [accountId, delta],
  );
  await c.query(
    'INSERT INTO transactions(account_id, currency, delta, balance_after, reason, ref_id) VALUES($1,$2,$3,$4,$5,$6)',
    [accountId, currency, delta, r.rows[0].bal, reason, refId ?? null],
  );
  return Number(r.rows[0].bal);
}

/** Grant skills whose unlockLevel is now reached for this job (D-006 permanence). */
export async function grantSkillUnlocks(c: PoolClient, accountId: number, jobId: string, level: number, allSkills: Record<string, { job: string; unlockLevel: number; kind: string }>) {
  const unlocked: string[] = [];
  for (const s of Object.values(allSkills)) {
    if (s.job === jobId && s.kind !== 'normal' && s.unlockLevel <= level) {
      const r = await c.query(
        'INSERT INTO skills_unlocked(account_id, skill_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING skill_id',
        [accountId, (s as { id?: string }).id ?? ''],
      );
      if (r.rowCount) unlocked.push(r.rows[0].skill_id);
    }
  }
  return unlocked;
}
