/**
 * Deterministic Timeline Auto-Battle Engine v2 (docs/01-combat, M3).
 * Adds: buffs/debuffs (timed stat mods), DoT, cleanse, AoE / random-target skills,
 * per-cast effects (ignoreDefPct, bonusCritRate), passive-driven healing bonus.
 * Determinism contract unchanged: only BattleSetup + seeded PRNG. No Date, no Math.random.
 * Multi-hit convention: skills.json stores the PER-HIT multiplier.
 */
import gameData from '../data/game.json' with { type: 'json' };
import skillsData from '../data/skills.json' with { type: 'json' };
import { mulberry32, type Rng } from './rng.js';
import type {
  BattleEvent, BattleOutcome, BattleSetup, EffectDef, ModStat, SimResult, SkillDef, UnitSnapshot,
} from '../types/core.js';

const C = gameData.combat;
const SKILLS = skillsData as unknown as Record<string, SkillDef>;

interface Mod { stat: ModStat; flat: number; pct: number; remaining: number; debuff: boolean }
interface Dot { perProc: number; interval: number; remaining: number; counter: number; sourceId: string; skillId: string }

interface UnitState {
  snap: UnitSnapshot;
  hp: number;
  energy: number;
  gauge: number;
  cooldowns: Map<string, number>;
  mods: Mod[];
  dots: Dot[];
  alive: boolean;
  damageDealt: number;
}

export function getSkill(id: string): SkillDef {
  const s = SKILLS[id];
  if (!s) throw new Error(`Unknown skill: ${id}`);
  return s;
}

/** Effective stat = (base + Σflat) × (1 + Σpct/100), floored at 0. */
function eff(u: UnitState, stat: ModStat): number {
  let flat = 0, pct = 0;
  for (const m of u.mods) if (m.stat === stat) { flat += m.flat; pct += m.pct; }
  const base = (u.snap as unknown as Record<string, number>)[stat] ?? 0;
  return Math.max(0, (base + flat) * (1 + pct / 100));
}

export function simulate(setup: BattleSetup): SimResult {
  const rng = mulberry32(setup.seed);
  const units: UnitState[] = setup.units.map((snap) => ({
    snap, hp: snap.maxHp, energy: 0, gauge: 0,
    cooldowns: new Map(), mods: [], dots: [], alive: true, damageDealt: 0,
  }));
  const byId = new Map(units.map((u) => [u.snap.id, u]));
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
    // 1) cooldowns
    for (const u of units) for (const [k, v] of u.cooldowns) if (v > 0) u.cooldowns.set(k, v - 1);

    // 2) DoT processing (deterministic order: unit array order, dot application order)
    for (const u of units) {
      if (!u.alive || u.dots.length === 0) continue;
      for (const dot of u.dots) {
        dot.counter++; dot.remaining--;
        if (dot.counter % dot.interval === 0 && u.alive) {
          const value = Math.max(1, dot.perProc);
          u.hp -= value;
          const src = byId.get(dot.sourceId);
          if (src) src.damageDealt += value;
          if (u.hp <= 0) {
            u.hp = 0; u.alive = false;
            events.push({ tick, type: 'damage', actor: dot.sourceId, target: u.snap.id, skillId: dot.skillId, value, crit: false, miss: false, targetHp: 0 });
            events.push({ tick, type: 'death', target: u.snap.id });
          } else {
            events.push({ tick, type: 'damage', actor: dot.sourceId, target: u.snap.id, skillId: dot.skillId, value, crit: false, miss: false, targetHp: u.hp });
          }
        }
      }
      u.dots = u.dots.filter((d) => d.remaining > 0);
      const end = checkEnd();
      if (end) { outcome = end; endTick = tick; break outer; }
    }

    // 3) buff/debuff expiry
    for (const u of units) {
      for (const m of u.mods) m.remaining--;
      u.mods = u.mods.filter((m) => m.remaining > 0);
    }

    // 4) gauge accumulation (effective SPD)
    for (const u of living()) u.gauge += Math.max(C.spdMin, Math.floor(eff(u, 'spd')));

    // 5) actors this tick
    const actors = living()
      .filter((u) => u.gauge >= C.gaugeMax)
      .sort((a, b) => b.gauge - a.gauge || b.snap.spd - a.snap.spd || (rng() < 0.5 ? -1 : 1));

    for (const actor of actors) {
      if (!actor.alive) continue;
      act(actor, units, rng, events, tick);
      actor.gauge -= C.gaugeMax;
      const end = checkEnd();
      if (end) { outcome = end; endTick = tick; break outer; }
    }
  }

  events.push({ tick: endTick, type: 'end', outcome });

  const damageDealt: Record<string, number> = {};
  const hpRemaining: Record<string, number> = {};
  for (const u of units) { damageDealt[u.snap.id] = u.damageDealt; hpRemaining[u.snap.id] = u.hp; }
  return { outcome, ticks: endTick, events, damageDealt, hpRemaining, checksum: checksum(units, outcome, endTick) };
}

/** Decision tree (docs/01-combat/05): Ultimate → P1..P4 → Normal Attack. */
function act(actor: UnitState, units: UnitState[], rng: Rng, events: BattleEvent[], tick: number) {
  if (actor.snap.ultimateSkill && actor.energy >= C.ultCost) {
    const ult = getSkill(actor.snap.ultimateSkill);
    const targets = selectTargets(ult, actor, units, rng);
    if (targets.length > 0) {
      actor.energy -= C.ultCost;
      cast(actor, ult, targets, units, rng, events, tick);
      return;
    }
  }
  for (const slotId of actor.snap.prioritySkills) {
    if (!slotId) continue;
    const skill = getSkill(slotId);
    if ((actor.cooldowns.get(skill.id) ?? 0) > 0) continue;
    if (!castCondition(skill, actor, units)) continue;
    const targets = selectTargets(skill, actor, units, rng);
    if (targets.length === 0) continue;
    actor.cooldowns.set(skill.id, skill.cooldown);
    cast(actor, skill, targets, units, rng, events, tick);
    return;
  }
  const normal = getSkill(actor.snap.normalAttackStat === 'PATK' ? 'normal.physical' : 'normal.magic');
  const targets = selectTargets(normal, actor, units, rng);
  if (targets.length > 0) cast(actor, normal, targets, units, rng, events, tick);
}

function castCondition(skill: SkillDef, actor: UnitState, units: UnitState[]): boolean {
  const cond = skill.castCondition;
  if (cond === 'always') return true;
  if (cond === 'selfHasDebuff') return actor.mods.some((m) => m.debuff) || actor.dots.length > 0;
  let m = /^selfHp<=(\d+)$/.exec(cond);
  if (m) return (actor.hp / actor.snap.maxHp) * 100 <= Number(m[1]);
  m = /^targets>=(\d+)$/.exec(cond);
  if (m) return units.filter((u) => u.alive && u.snap.side !== actor.snap.side).length >= Number(m[1]);
  m = /^allyHp<=(\d+)$/.exec(cond);
  if (m) {
    const allies = units.filter((u) => u.alive && u.snap.side === actor.snap.side);
    if (allies.length === 0) return false;
    const lowest = allies.reduce((a, b) => (a.hp / a.snap.maxHp <= b.hp / b.snap.maxHp ? a : b));
    return (lowest.hp / lowest.snap.maxHp) * 100 <= Number(m[1]);
  }
  return true; // unknown conditions never block; validated at data load server-side
}

function selectTargets(skill: SkillDef, actor: UnitState, units: UnitState[], rng: Rng): UnitState[] {
  const enemies = units.filter((u) => u.alive && u.snap.side !== actor.snap.side);
  const allies = units.filter((u) => u.alive && u.snap.side === actor.snap.side);
  switch (skill.targeting) {
    case 'self': return [actor];
    case 'lowestHpAlly':
      return allies.length ? [allies.reduce((a, b) => (a.hp <= b.hp ? a : b))] : [];
    case 'allEnemies': return enemies;
    case 'highestAtkEnemy': {
      if (!enemies.length) return [];
      return [enemies.reduce((a, b) =>
        Math.max(eff(a, 'patk'), eff(a, 'matk')) >= Math.max(eff(b, 'patk'), eff(b, 'matk')) ? a : b)];
    }
    case 'randomEnemies': {
      if (!enemies.length) return [];
      const n = skill.targetCount ?? 1;
      const picks: UnitState[] = [];
      for (let i = 0; i < n; i++) picks.push(enemies[Math.floor(rng() * enemies.length)]);
      return picks; // with replacement — a small pack can eat multiple bolts
    }
    case 'lowestHpEnemy':
    default:
      return enemies.length ? [enemies.reduce((a, b) => (a.hp <= b.hp ? a : b))] : [];
  }
}

/** Per-hit PRNG draw order: hit → variance → crit (docs/01-combat/03). */
function cast(actor: UnitState, skill: SkillDef, targets: UnitState[], units: UnitState[], rng: Rng, events: BattleEvent[], tick: number) {
  events.push({ tick, type: 'action', actor: actor.snap.id, skillId: skill.id });
  const atkValue = skill.governingStat === 'PATK' ? eff(actor, 'patk') : eff(actor, 'matk');
  const fx = skill.effects ?? [];
  const ignoreDef = (fx.find((e) => e.type === 'ignoreDefPct') as { value: number } | undefined)?.value ?? 0;
  const bonusCrit = (fx.find((e) => e.type === 'bonusCritRate') as { value: number } | undefined)?.value ?? 0;

  // pure buff/debuff schools: no damage roll, apply effects to targets
  if (skill.school === 'buff' || skill.school === 'debuff') {
    for (const target of targets) {
      applyEffects(actor, skill, target, fx, events, tick);
      events.push({ tick, type: 'buff', actor: actor.snap.id, target: target.snap.id, skillId: skill.id, debuff: skill.school === 'debuff' });
    }
    gainEnergy(actor, C.energyGain.skill);
    return;
  }

  for (const target of targets) {
    for (let h = 0; h < skill.hits; h++) {
      if (!target.alive) break;

      if (skill.school === 'heal') {
        const healBoost = 1 + (actor.snap.healingPct ?? 0);
        const varied = atkValue * skill.multiplier * healBoost * randRange(rng, C.variance.min, C.variance.max);
        const crit = rng() * 100 < eff(actor, 'critRate');
        const value = Math.max(1, Math.floor(crit ? varied * (C.healCritDmg / 100) : varied));
        target.hp = Math.min(target.snap.maxHp, target.hp + value);
        events.push({ tick, type: 'heal', actor: actor.snap.id, target: target.snap.id, skillId: skill.id, value, crit, targetHp: target.hp });
        applyEffects(actor, skill, target, fx, events, tick);
        gainEnergy(actor, C.energyGain.skill);
        continue;
      }

      const hitChance = clamp(C.hit.base + (eff(actor, 'hit') - eff(target, 'flee')) * C.hit.scale, C.hit.min, C.hit.max);
      const miss = rng() * 100 >= hitChance;
      if (miss) {
        events.push({ tick, type: 'damage', actor: actor.snap.id, target: target.snap.id, skillId: skill.id, value: 0, crit: false, miss: true, targetHp: target.hp });
        gainEnergy(actor, C.energyGain.miss);
        continue;
      }
      const defVal = eff(target, 'def') * (1 - ignoreDef / 100);
      const mitigated = (atkValue * skill.multiplier) * 100 / (100 + defVal);
      let varied = mitigated * randRange(rng, C.variance.min, C.variance.max);
      const crit = rng() * 100 < eff(actor, 'critRate') + bonusCrit;
      if (crit) varied *= eff(actor, 'critDmg') / 100;
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
        applyEffects(actor, skill, target, fx, events, tick); // on-hit riders (e.g. venom DoT)
      }
    }
  }
}

/** Apply statMod / dot / cleanse riders. ignoreDefPct & bonusCritRate are read inside cast(). */
function applyEffects(actor: UnitState, skill: SkillDef, target: UnitState, fx: EffectDef[], events: BattleEvent[], tick: number) {
  for (const e of fx) {
    if (e.type === 'statMod') {
      const debuff = (e.pct ?? 0) < 0 || (e.flat ?? 0) < 0;
      target.mods.push({ stat: e.stat, flat: e.flat ?? 0, pct: e.pct ?? 0, remaining: e.duration, debuff });
    } else if (e.type === 'dot') {
      const atk = e.stat === 'PATK' ? eff(actor, 'patk') : eff(actor, 'matk');
      const perProc = Math.max(1, Math.floor(atk * e.mult * 100 / (100 + eff(target, 'def'))));
      target.dots.push({ perProc, interval: e.interval, remaining: e.duration, counter: 0, sourceId: actor.snap.id, skillId: skill.id });
    } else if (e.type === 'cleanse') {
      target.mods = target.mods.filter((m) => !m.debuff);
      target.dots = [];
    }
  }
}

function gainEnergy(u: UnitState, base: number) {
  if (!u.alive) return;
  u.energy = Math.min(u.snap.maxEnergy, u.energy + base);
}
function randRange(rng: Rng, min: number, max: number): number { return min + rng() * (max - min); }
function clamp(v: number, min: number, max: number): number { return Math.min(max, Math.max(min, v)); }

function checksum(units: UnitState[], outcome: BattleOutcome, ticks: number): number {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => { h ^= n >>> 0; h = Math.imul(h, 16777619) >>> 0; };
  mix(ticks);
  mix(outcome === 'victory' ? 1 : outcome === 'defeat' ? 2 : 3);
  for (const u of units) { mix(u.hp); mix(u.energy); mix(u.damageDealt); }
  return h;
}
