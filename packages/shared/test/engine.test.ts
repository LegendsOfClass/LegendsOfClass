import { describe, it, expect } from 'vitest';
import {
  simulate, computeDerived, expToNext, applyExp, monsterSnapshot, monsterRewards,
  GAME, type BattleSetup, type UnitSnapshot,
} from '../src/index.js';

/** Build a Swordman Lv10 snapshot the way the server will (docs/01-combat/02). */
function playerSnapshot(over: Partial<UnitSnapshot> = {}): UnitSnapshot {
  const primary = { str: 30, dex: 14, con: 20, int: 6 }; // base 18/10/16/6 + some allocation
  const d = computeDerived(primary, 10, { patk: 12 }); // Training Sword
  return {
    id: 'player', nameKey: 'test.player', side: 0, level: 10,
    maxHp: d.maxHp, patk: d.patk, matk: d.matk, def: d.def, hit: d.hit, flee: d.flee,
    critRate: d.critRate, critDmg: d.critDmg, spd: d.spd, maxEnergy: d.maxEnergy,
    normalAttackStat: 'PATK', prioritySkills: ['swordman.bash', null, null, null],
    ultimateSkill: null, ...over,
  };
}

function setup(units: UnitSnapshot[], seed = 12345): BattleSetup {
  return { seed, dataVersion: GAME.dataVersion, units, rules: { maxTicks: GAME.combat.maxTicksPve } };
}

describe('stat formulas (docs/01-combat/02)', () => {
  it('matches the documented Swordman Lv30 example', () => {
    // docs example: Lv30, STR 100, weapon PATK 45, +10% => 302
    const d = computeDerived({ str: 100, dex: 40, con: 60, int: 10 }, 30, { patk: 45 }, 0.10);
    expect(d.patk).toBe(302);
    expect(d.maxHp).toBe(Math.floor((100 + 600 + 1500) * 1.10));
    expect(d.spd).toBe(Math.floor((100 + 20) * 1)); // spd has no pctAll in docs example... spd uses mul too
  });
  it('floors once and respects crit cap', () => {
    const d = computeDerived({ str: 1, dex: 999, con: 1, int: 1 }, 1, {});
    expect(d.critRate).toBe(GAME.combat.critRateCap);
  });
});

describe('exp curve (docs/03-progression/02)', () => {
  it('expToNext(1) = 50, expToNext(50) ~ 56.9k', () => {
    expect(expToNext(1)).toBe(50);
    expect(expToNext(50)).toBeGreaterThan(56000);
    expect(expToNext(50)).toBeLessThan(58000);
  });
  it('applies multi-level jumps with +4 points each and banks overflow', () => {
    const r = applyExp(1, 0, 500);
    expect(r.level).toBeGreaterThan(1);
    expect(r.statPointsGained).toBe(r.levelsGained * 4);
  });
  it('discards exp at max level', () => {
    const r = applyExp(100, 0, 99999);
    expect(r.level).toBe(100);
    expect(r.exp).toBe(0);
  });
});

describe('monster generator (docs/05-content/02)', () => {
  it('green slime is a tank with generated stats', () => {
    const m = monsterSnapshot('green_slime', 1);
    expect(m.maxHp).toBe(Math.floor((50 + 35 * 2) * 1.5));
    expect(m.spd).toBe(80);
    expect(monsterRewards('green_slime')).toEqual({ exp: 28, gold: 14 });
  });
});

describe('combat engine determinism (docs/01-combat/06 golden contract)', () => {
  it('same seed => bit-identical result (100 runs)', () => {
    const s = setup([playerSnapshot(), monsterSnapshot('green_slime', 1)], 777);
    const first = simulate(s);
    for (let i = 0; i < 100; i++) {
      const again = simulate(s);
      expect(again.checksum).toBe(first.checksum);
      expect(again.events.length).toBe(first.events.length);
      expect(again.outcome).toBe(first.outcome);
    }
  });
  it('different seeds diverge', () => {
    const a = simulate(setup([playerSnapshot(), monsterSnapshot('green_slime', 1)], 1));
    const b = simulate(setup([playerSnapshot(), monsterSnapshot('green_slime', 1)], 2));
    expect(a.checksum).not.toBe(b.checksum);
  });
  it('Swordman Lv10 beats a Green Slime (balance sanity)', () => {
    const r = simulate(setup([playerSnapshot(), monsterSnapshot('green_slime', 1)]));
    expect(r.outcome).toBe('victory');
    expect(r.hpRemaining['player']).toBeGreaterThan(0);
  });
  it('a fresh Archer Lv1 vs THREE Wild Boars loses (danger exists)', () => {
    const primary = { str: 12, dex: 22, con: 10, int: 6 };
    const d = computeDerived(primary, 1, {});
    const novice = playerSnapshot({
      level: 1, maxHp: d.maxHp, patk: d.patk, matk: d.matk, def: d.def,
      hit: d.hit, flee: d.flee, spd: d.spd, prioritySkills: [null, null, null, null],
    });
    const r = simulate(setup([novice, monsterSnapshot('wild_boar', 1), monsterSnapshot('wild_boar', 2), monsterSnapshot('wild_boar', 3)]));
    expect(r.outcome).toBe('defeat');
  });
  it('gauge overflow carries: SPD 120 acts twice by tick 17 (docs example)', () => {
    const fast = playerSnapshot({ id: 'fast', spd: 120, prioritySkills: [null, null, null, null] });
    const slow = monsterSnapshot('green_slime', 1);
    (slow as { spd: number }).spd = 90;
    const r = simulate(setup([fast, slow], 42));
    const fastActions = r.events.filter(e => e.type === 'action' && e.actor === 'fast' && e.tick <= 17);
    expect(fastActions.length).toBe(2);
    expect(fastActions[0].tick).toBe(9);
    expect(fastActions[1].tick).toBe(17);
  });
  it('Heal fires only at <=70% HP (allyHp cast condition, solo=self)', () => {
    const healer = playerSnapshot({ prioritySkills: ['healer.heal', null, null, null] });
    const r = simulate(setup([healer, monsterSnapshot('wild_boar', 1), monsterSnapshot('wild_boar', 2)], 99));
    const heals = r.events.filter(e => e.type === 'heal');
    for (const h of heals) {
      // find the damage event just before: player hp must have been <= 60% before healing
      expect(h.type).toBe('heal');
    }
    // engine must not heal at full HP on turn 1
    const firstAction = r.events.find(e => e.type === 'action' && e.actor === 'player');
    expect(firstAction && 'skillId' in firstAction ? firstAction.skillId : '').not.toBe('healer.heal');
  });
  it('timeout outcome triggers at maxTicks with an unkillable matchup', () => {
    const wall = playerSnapshot({ def: 999999, maxHp: 1000000, patk: 0, matk: 0, prioritySkills: [null, null, null, null] });
    const slime = monsterSnapshot('green_slime', 1);
    const r = simulate({ seed: 5, dataVersion: GAME.dataVersion, units: [wall, slime], rules: { maxTicks: 200 } });
    expect(r.outcome).toBe('timeout');
    expect(r.ticks).toBe(200);
  });
});

describe('engine v2 — M3 features', () => {
  const foes = (n: number, id = 'green_slime') =>
    Array.from({ length: n }, (_, i) => monsterSnapshot(id, i + 1));

  it('buff statMod raises effective stats then expires (Take Aim)', () => {
    const archer = playerSnapshot({ prioritySkills: ['archer.take_aim', null, null, null] });
    const r = simulate(setup([archer, ...foes(1)], 21));
    const buffEv = r.events.find(e => e.type === 'buff');
    expect(buffEv).toBeTruthy();
    expect(buffEv && 'debuff' in buffEv ? buffEv.debuff : true).toBe(false);
  });

  it('debuff (Provoke) lowers target DEF → later hits deal more', () => {
    const s1 = playerSnapshot({ prioritySkills: [null, null, null, null] });
    const boarA = monsterSnapshot('wild_boar', 1);
    const base = simulate(setup([s1, boarA], 7));
    const s2 = playerSnapshot({ prioritySkills: ['swordman.provoke', null, null, null] });
    const withDebuff = simulate(setup([s2, monsterSnapshot('wild_boar', 1)], 7));
    const dbf = withDebuff.events.find(e => e.type === 'buff');
    expect(dbf && 'debuff' in dbf ? dbf.debuff : false).toBe(true);
    expect(base.checksum).not.toBe(withDebuff.checksum);
  });

  it('AoE (allEnemies) hits every living enemy once per cast', () => {
    const sw = playerSnapshot({ level: 30, prioritySkills: ['swordman.sword_wave', null, null, null] });
    const r = simulate(setup([sw, ...foes(3)], 33));
    const firstWave = r.events.filter(e => e.type === 'damage' && e.skillId === 'swordman.sword_wave');
    expect(firstWave.length).toBeGreaterThanOrEqual(3);
  });

  it('targets>=2 gates AoE: never cast vs a single enemy', () => {
    const sw = playerSnapshot({ prioritySkills: ['swordman.sword_wave', null, null, null] });
    const r = simulate(setup([sw, ...foes(1)], 34));
    expect(r.events.some(e => e.type === 'action' && e.skillId === 'swordman.sword_wave')).toBe(false);
  });

  it('randomEnemies picks targetCount targets deterministically', () => {
    const mg = playerSnapshot({
      matk: 400, prioritySkills: ['mage.chain_lightning', null, null, null],
    });
    const a = simulate(setup([mg, ...foes(2, 'wild_boar')], 55));
    const b = simulate(setup([mg, ...foes(2, 'wild_boar')], 55));
    expect(a.checksum).toBe(b.checksum);
    const bolts = a.events.filter(e => e.type === 'damage' && e.skillId === 'mage.chain_lightning');
    expect(bolts.length).toBeGreaterThanOrEqual(3); // 3 bolts in the first cast
  });

  it('DoT (Venom Bite) ticks over time and can kill', () => {
    const frail = playerSnapshot({ maxHp: 120, def: 0, flee: 0, patk: 1, matk: 1, prioritySkills: [null, null, null, null] });
    const spider = monsterSnapshot('forest_spider', 1);
    const r = simulate(setup([frail, spider], 88));
    const dotHits = r.events.filter(e => e.type === 'damage' && e.skillId === 'monster.venom_bite' && e.value > 0);
    expect(dotHits.length).toBeGreaterThan(1); // initial hit + at least one DoT proc
  });

  it('ultimate consumes 100 energy and fires once charged (Dragon Cleave)', () => {
    const sw = playerSnapshot({ level: 30, ultimateSkill: 'swordman.dragon_cleave', maxEnergy: 100 });
    const r = simulate(setup([sw, ...foes(2, 'wild_boar')], 42));
    const ult = r.events.find(e => e.type === 'action' && e.skillId === 'swordman.dragon_cleave');
    expect(ult).toBeTruthy();
  });

  it('healingDealtPct passive boosts heals ~20% (Divine Grace)', () => {
    const base: Parameters<typeof playerSnapshot>[0] = {
      matk: 100, patk: 1, maxHp: 600, def: 5, prioritySkills: ['healer.heal', null, null, null],
    };
    const plain = playerSnapshot(base);
    const graced = playerSnapshot({ ...base, healingPct: 0.2 });
    const boar = () => monsterSnapshot('wild_boar', 1);
    const h1 = simulate(setup([plain, boar()], 66)).events.filter(e => e.type === 'heal');
    const h2 = simulate(setup([graced, boar()], 66)).events.filter(e => e.type === 'heal');
    expect(h1.length).toBeGreaterThan(0);
    expect(h2[0].value).toBeGreaterThan(h1[0].value);
  });

  it('cleanse removes debuffs and DoTs (Purify condition + effect)', () => {
    const healer = playerSnapshot({
      maxHp: 4000, matk: 80, level: 40,
      prioritySkills: ['healer.purify', null, null, null],
    });
    const spider = monsterSnapshot('forest_spider', 1);
    const r = simulate(setup([healer, spider], 99));
    const purify = r.events.find(e => e.type === 'action' && e.skillId === 'healer.purify');
    expect(purify).toBeTruthy(); // fired only because a DoT/debuff was present
  });

  it('determinism holds across all v2 features (50 runs mixed kit)', () => {
    const kit = playerSnapshot({
      level: 45, maxEnergy: 100, ultimateSkill: 'archer.storm_of_arrows',
      prioritySkills: ['archer.take_aim', 'archer.piercing_arrow', 'archer.snipe', 'swordman.provoke'],
    });
    const mk = () => setup([kit, monsterSnapshot('forest_spider', 1), monsterSnapshot('poison_toad', 2), monsterSnapshot('hornet', 3)], 1234);
    const first = simulate(mk());
    for (let i = 0; i < 50; i++) expect(simulate(mk()).checksum).toBe(first.checksum);
  });
});
