/**
 * Deterministic Timeline Auto-Battle Engine (docs/01-combat).
 * Runs identically on server (authoritative resolution) and client (visual replay) - D-017.
 * Determinism contract: only BattleSetup + seeded PRNG + integer ticks. No Date, no Math.random.
 * Multi-hit convention: skills.json stores the PER-HIT multiplier (e.g. Double Strike 0.8 x 2 hits).
 */
import gameData from '../data/game.json' with { type: 'json' };
import skillsData from '../data/skills.json' with { type: 'json' };
import { mulberry32, type Rng } from './rng.js';
import type {
  BattleEvent, BattleOutcome, BattleSetup, SimResult, SkillDef, UnitSnapshot,
} from '../types/core.js';

const C = gameData.combat;
const SKILLS = skillsData as unknown as Record<string, SkillDef>;

interface UnitState {
  snap: UnitSnapshot;
  hp: number;
  energy: number;
  gauge: number;
  cooldowns: Map<string, number>;
  alive: boolean;
  damageDealt: number;
}

export function getSkill(id: string): SkillDef {
  const s = SKILLS[id];
  if (!s) throw new Error(`Unknown skill: ${id}`);
  return s;
}

export function simulate(setup: BattleSetup): SimResult {
  const rng = mulberry32(setup.seed);
  const units: UnitState[] = setup.units.map((snap) => ({
    snap, hp: snap.maxHp, energy: 0, gauge: 0,
    cooldowns: new Map(), alive: true, damageDealt: 0,
  }));
  const events: BattleEvent[] = [];
  let outcome: BattleOutcome = 'timeout';
  let endTick = setup.rules.maxTicks;

  const living = (side?: 0 | 1) =>
    units.filter((u) => u.alive && (side === undefined || u.snap.side === side));

  const checkEnd = (): BattleOutcome | null => {
    if (living(1).length === 0) return 'victory';
    if (living(0).length === 0) return 'defeat';
    return null;
  };

  outer:
  for (let tick = 1; tick <= setup.rules.maxTicks; tick++) {
    // 1) advance cooldowns (docs/01-combat/01 flow)
    for (const u of units) {
      for (const [k, v] of u.cooldowns) if (v > 0) u.cooldowns.set(k, v - 1);
    }
    // 2) gauge accumulation (+SPD per tick, clamped by spdMin)
    for (const u of living()) u.gauge += Math.max(C.spdMin, u.snap.spd);
    // 3) actors this tick: gauge desc -> spd desc -> deterministic coin flip
    const actors = living()
      .filter((u) => u.gauge >= C.gaugeMax)
      .sort((a, b) =>
        b.gauge - a.gauge || b.snap.spd - a.snap.spd || (rng() < 0.5 ? -1 : 1));
    // 4) resolve actions in order; a unit killed earlier this tick loses its action
    for (const actor of actors) {
      if (!actor.alive) continue;
      act(actor, units, rng, events, tick);
      actor.gauge -= C.gaugeMax; // overflow carries (docs/01-combat/01)
      const end = checkEnd();
      if (end) { outcome = end; endTick = tick; break outer; }
    }
  }

  events.push({ tick: endTick, type: 'end', outcome });

  const damageDealt: Record<string, number> = {};
  const hpRemaining: Record<string, number> = {};
  for (const u of units) {
    damageDealt[u.snap.id] = u.damageDealt;
    hpRemaining[u.snap.id] = u.hp;
  }
  return {
    outcome, ticks: endTick, events, damageDealt, hpRemaining,
    checksum: checksum(units, outcome, endTick),
  };
}

/** Priority AI decision tree (docs/01-combat/05): Ultimate -> P1..P4 -> Normal Attack. */
function act(actor: UnitState, units: UnitState[], rng: Rng, events: BattleEvent[], tick: number) {
  if (actor.snap.ultimateSkill && actor.energy >= C.ultCost) {
    const ult = getSkill(actor.snap.ultimateSkill);
    const targets = selectTargets(ult, actor, units);
    if (targets.length > 0) {
      actor.energy -= C.ultCost;
      cast(actor, ult, targets, rng, events, tick);
      return;
    }
  }
  for (const slotId of actor.snap.prioritySkills) {
    if (!slotId) continue;
    const skill = getSkill(slotId);
    if ((actor.cooldowns.get(skill.id) ?? 0) > 0) continue;
    if (!castCondition(skill, actor, units)) continue;
    const targets = selectTargets(skill, actor, units);
    if (targets.length === 0) continue;
    actor.cooldowns.set(skill.id, skill.cooldown);
    cast(actor, skill, targets, rng, events, tick);
    return;
  }
  const normal = getSkill(actor.snap.normalAttackStat === 'PATK' ? 'normal.physical' : 'normal.magic');
  const targets = selectTargets(normal, actor, units);
  if (targets.length > 0) cast(actor, normal, targets, rng, events, tick);
}

function castCondition(skill: SkillDef, actor: UnitState, units: UnitState[]): boolean {
  const cond = skill.castCondition;
  if (cond === 'always') return true;
  let m = /^selfHp<=(\d+)$/.exec(cond);
  if (m) return (actor.hp / actor.snap.maxHp) * 100 <= Number(m[1]);
  m = /^targets>=(\d+)$/.exec(cond);
  if (m) return units.filter((u) => u.alive && u.snap.side !== actor.snap.side).length >= Number(m[1]);
  return true; // unknown condition fails open; server validates data at load time
}

function selectTargets(skill: SkillDef, actor: UnitState, units: UnitState[]): UnitState[] {
  const enemies = units.filter((u) => u.alive && u.snap.side !== actor.snap.side);
  const allies = units.filter((u) => u.alive && u.snap.side === actor.snap.side);
  switch (skill.targeting) {
    case 'self': return [actor];
    case 'lowestHpAlly':
      return allies.length ? [allies.reduce((a, b) => (a.hp <= b.hp ? a : b))] : [];
    case 'lowestHpEnemy':
    default:
      return enemies.length ? [enemies.reduce((a, b) => (a.hp <= b.hp ? a : b))] : [];
  }
}

/** Damage/heal pipeline - fixed PRNG draw order per hit: hit -> variance -> crit (docs/01-combat/03). */
function cast(actor: UnitState, skill: SkillDef, targets: UnitState[], rng: Rng, events: BattleEvent[], tick: number) {
  events.push({ tick, type: 'action', actor: actor.snap.id, skillId: skill.id });
  const atkValue = skill.governingStat === 'PATK' ? actor.snap.patk : actor.snap.matk;

  for (const target of targets) {
    for (let h = 0; h < skill.hits; h++) {
      if (!target.alive) break;

      if (skill.school === 'heal') {
        const varied = atkValue * skill.multiplier * randRange(rng, C.variance.min, C.variance.max);
        const crit = rng() * 100 < actor.snap.critRate;
        const value = Math.max(1, Math.floor(crit ? varied * (C.healCritDmg / 100) : varied));
        target.hp = Math.min(target.snap.maxHp, target.hp + value);
        events.push({ tick, type: 'heal', actor: actor.snap.id, target: target.snap.id, skillId: skill.id, value, crit, targetHp: target.hp });
        gainEnergy(actor, C.energyGain.skill);
        continue;
      }

      const hitChance = clamp(C.hit.base + (actor.snap.hit - target.snap.flee) * C.hit.scale, C.hit.min, C.hit.max);
      const miss = rng() * 100 >= hitChance;
      if (miss) {
        events.push({ tick, type: 'damage', actor: actor.snap.id, target: target.snap.id, skillId: skill.id, value: 0, crit: false, miss: true, targetHp: target.hp });
        gainEnergy(actor, C.energyGain.miss);
        continue;
      }
      const mitigated = (atkValue * skill.multiplier) * 100 / (100 + target.snap.def);
      let varied = mitigated * randRange(rng, C.variance.min, C.variance.max);
      const crit = rng() * 100 < actor.snap.critRate;
      if (crit) varied *= actor.snap.critDmg / 100;
      const value = Math.max(1, Math.floor(varied));

      target.hp -= value;
      actor.damageDealt += value;
      gainEnergy(actor, skill.kind === 'normal' ? C.energyGain.attack : C.energyGain.skill);
      gainEnergy(target, C.energyGain.hitTaken);

      if (target.hp <= 0) {
        target.hp = 0; target.alive = false;
        events.push({ tick, type: 'damage', actor: actor.snap.id, target: target.snap.id, skillId: skill.id, value, crit, miss: false, targetHp: 0 });
        events.push({ tick, type: 'death', target: target.snap.id });
        gainEnergy(actor, C.energyGain.kill);
      } else {
        events.push({ tick, type: 'damage', actor: actor.snap.id, target: target.snap.id, skillId: skill.id, value, crit, miss: false, targetHp: target.hp });
      }
    }
  }
}

function gainEnergy(u: UnitState, base: number) {
  if (!u.alive) return;
  u.energy = Math.min(u.snap.maxEnergy, u.energy + base);
}

function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Order-stable integer checksum for replay verification (docs/01-combat/06). */
function checksum(units: UnitState[], outcome: BattleOutcome, ticks: number): number {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => { h ^= n >>> 0; h = Math.imul(h, 16777619) >>> 0; };
  mix(ticks);
  mix(outcome === 'victory' ? 1 : outcome === 'defeat' ? 2 : 3);
  for (const u of units) { mix(u.hp); mix(u.energy); mix(u.damageDealt); }
  return h;
}
