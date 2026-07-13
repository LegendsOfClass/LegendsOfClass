import { randomUUID, randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  simulate, computeDerived, applyExp, monsterSnapshot, monsterRewards,
  GAME, JOBS, ITEMS, MAPS, SKILLS,
  type BattleSetup, type UnitSnapshot, type BattleResponse,
} from '@loce/shared';
import { tx } from '../db/pool.js';
import { primaryStatsFor, gearBonusFor, addCurrency, grantSkillUnlocks, type JobRow, type ItemRow } from './accountService.js';
import { devFlags } from './devService.js';

const RARITY = GAME.rarity;

/** Server-side (non-deterministic) rolls use crypto randomness — never the battle seed. */
function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = (randomInt(0, 1_000_000) / 1_000_000) * total;
  for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
  return entries[entries.length - 1][0];
}

/** Is this priority layout legal for the given job right now? (docs/01-combat/05) */
export function validatePriority(slots: (string | null)[], jobId: string, level: number, skillsUnlocked: string[]): string | null {
  if (!Array.isArray(slots) || slots.length !== 4) return 'error.priority.shape';
  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const id = slots[i];
    if (id === null) continue;
    const sk = SKILLS[id];
    if (!sk || sk.kind !== 'skill') return 'error.priority.notActive';
    if (!skillsUnlocked.includes(id)) return 'error.priority.locked';
    if (sk.job === jobId && sk.unlockLevel > level) return 'error.priority.levelTooLow';
    if (i === 0 && sk.job !== jobId) return 'error.priority.p1OwnJob'; // D-006
    if (seen.has(id)) return 'error.priority.duplicate';
    seen.add(id);
  }
  return null;
}

/** Auto-fill fallback: own-job unlocked actives in unlock order (used when a player has not configured slots). */
export function autoPriority(jobRow: JobRow, skillsUnlocked: string[]): (string | null)[] {
  const own = skillsUnlocked
    .filter((id) => SKILLS[id]?.job === jobRow.job_id && SKILLS[id].kind === 'skill' && SKILLS[id].unlockLevel <= jobRow.level)
    .sort((a, b) => SKILLS[a].unlockLevel - SKILLS[b].unlockLevel)
    .slice(0, 4);
  return [own[0] ?? null, own[1] ?? null, own[2] ?? null, own[3] ?? null];
}

export function buildPlayerSnapshot(
  jobRow: JobRow, items: ItemRow[], skillsUnlocked: string[], displayName: string, god = false,
): UnitSnapshot {
  const job = JOBS[jobRow.job_id];
  const primary = primaryStatsFor(jobRow);
  const gear = gearBonusFor(items, RARITY.statMult);
  const d = computeDerived(primary, jobRow.level, gear);
  if (god) { d.patk *= 100; d.matk *= 100; d.maxHp *= 100; d.def *= 100; } // Dev Mode only

  // Passives: data-driven from skills.json (unlocked + level met + own job)
  let healingPct = 0;
  for (const id of skillsUnlocked) {
    const sk = SKILLS[id];
    if (!sk || sk.kind !== 'passive' || sk.job !== jobRow.job_id || sk.unlockLevel > jobRow.level) continue;
    for (const e of sk.effects ?? []) {
      if (e.type === 'statMod') {
        const key = e.stat as keyof typeof d;
        if (typeof d[key] === 'number') {
          (d as unknown as Record<string, number>)[key] = Math.floor(((d as unknown as Record<string, number>)[key] + (e.flat ?? 0)) * (1 + (e.pct ?? 0) / 100));
        }
      } else if (e.type === 'healingDealtPct') {
        healingPct += e.value / 100;
      }
    }
  }

  // Ultimate: own-job ultimate, unlocked + level met
  const ult = Object.values(SKILLS).find(
    (sk) => sk.kind === 'ultimate' && sk.job === jobRow.job_id && sk.unlockLevel <= jobRow.level && skillsUnlocked.includes(sk.id),
  );

  // Priority: player-configured slots if legal, else auto-fill (docs/01-combat/05)
  let priority = jobRow.priority_slots ?? [null, null, null, null];
  const problem = validatePriority(priority, jobRow.job_id, jobRow.level, skillsUnlocked);
  const empty = priority.every((x) => x === null);
  if (problem || empty) priority = autoPriority(jobRow, skillsUnlocked);

  return {
    id: 'player', nameKey: displayName, side: 0, level: jobRow.level,
    maxHp: d.maxHp, patk: d.patk, matk: d.matk, def: d.def, hit: d.hit, flee: d.flee,
    critRate: d.critRate, critDmg: d.critDmg, spd: d.spd, maxEnergy: d.maxEnergy,
    normalAttackStat: job.normalAttackStat, healingPct, prioritySkills: priority, ultimateSkill: ult?.id ?? null,
  };
}

export async function startBattle(accountId: number, nodeId: string): Promise<BattleResponse> {
  return tx(async (c: PoolClient) => {
    // Load authoritative state (never trust client)
    const stateQ = await c.query('SELECT * FROM account_state WHERE account_id=$1 FOR UPDATE', [accountId]);
    if (!stateQ.rowCount) throw httpError(404, 'error.account.notFound');
    const state = stateQ.rows[0];

    // Validate node against the map the player is actually on
    const map = MAPS[state.current_map];
    const node = map?.nodes.find((n) => n.id === nodeId);
    if (!node) throw httpError(400, 'error.battle.invalidNode');

    const jobQ = await c.query('SELECT * FROM jobs WHERE account_id=$1 AND job_id=$2', [accountId, state.current_job_id]);
    const jobRow = jobQ.rows[0] as JobRow;
    const itemsQ = await c.query('SELECT id, item_id, rarity, enhance_level, equipped_slot FROM items WHERE account_id=$1', [accountId]);
    const skillsQ = await c.query('SELECT skill_id FROM skills_unlocked WHERE account_id=$1', [accountId]);
    const accQ = await c.query('SELECT display_name FROM accounts WHERE id=$1', [accountId]);

    const god = devFlags.get(accountId)?.god === true;
    const player = buildPlayerSnapshot(jobRow, itemsQ.rows, skillsQ.rows.map((r) => r.skill_id), accQ.rows[0].display_name, god);

    // Monster group 1-3 (config weights), server CSPRNG
    const sizeRoll = randomInt(0, 1000) / 1000;
    const w = GAME.battle.groupSizeWeights;
    const groupSize = sizeRoll < w[0] ? 1 : sizeRoll < w[0] + w[1] ? 2 : 3;
    const monsters = Array.from({ length: groupSize }, (_, i) => monsterSnapshot(node.monsterId, i + 1));

    const setup: BattleSetup = {
      seed: randomInt(1, 2 ** 31),
      dataVersion: GAME.dataVersion,
      units: [player, ...monsters],
      rules: { maxTicks: GAME.combat.maxTicksPve },
    };
    const sim = simulate(setup);

    // Rewards (only on victory; per docs loot earned = monsters killed, M1: all-or-nothing single wave)
    let exp = 0, gold = 0;
    const drops: { itemId: string; rarity: string; dbId: number }[] = [];
    let levelsGained = 0, newLevel = jobRow.level;

    if (sim.outcome === 'victory') {
      const per = monsterRewards(node.monsterId);
      exp = per.exp * groupSize;
      gold = per.gold * groupSize;

      const applied = applyExp(jobRow.level, jobRow.exp, exp);
      levelsGained = applied.levelsGained; newLevel = applied.level;
      await c.query(
        'UPDATE jobs SET level=$3, exp=$4, unspent_points=unspent_points+$5 WHERE account_id=$1 AND job_id=$2',
        [accountId, jobRow.job_id, applied.level, applied.exp, applied.statPointsGained],
      );
      if (levelsGained > 0) await grantSkillUnlocks(c, accountId, jobRow.job_id, applied.level, SKILLS as never);
      await addCurrency(c, accountId, 'gold', gold, 'battle');

      // Equipment drop rolls: one per monster killed (docs/05-content/01: 8% flat)
      const pool = Object.values(ITEMS).filter((it) => it.sourceMaps.includes(map.id));
      for (let i = 0; i < groupSize; i++) {
        if (randomInt(0, 10_000) / 10_000 < GAME.battle.equipDropChance && pool.length > 0) {
          const item = pool[randomInt(0, pool.length)];
          const rarity = weightedPick(map.rarityWeights as Record<string, number>);
          const ins = await c.query(
            'INSERT INTO items(account_id, item_id, rarity) VALUES($1,$2,$3) RETURNING id',
            [accountId, item.id, rarity],
          );
          drops.push({ itemId: item.id, rarity, dbId: Number(ins.rows[0].id) });
        }
      }
    }

    const battleId = randomUUID();
    await c.query(
      `INSERT INTO battles(battle_id, account_id, kind, node_id, seed, data_version, result, total_damage)
       VALUES($1,$2,'pve',$3,$4,$5,$6,$7)`,
      [battleId, accountId, nodeId, setup.seed, GAME.dataVersion,
        JSON.stringify({ outcome: sim.outcome, checksum: sim.checksum, exp, gold, drops }),
        sim.damageDealt['player'] ?? 0],
    );

    return {
      battleId, setup, outcome: sim.outcome, checksum: sim.checksum,
      rewards: { exp, gold, levelsGained, newLevel, drops },
    };
  });
}

export function httpError(status: number, messageKey: string) {
  const e = new Error(messageKey) as Error & { statusCode: number };
  e.statusCode = status;
  return e;
}
