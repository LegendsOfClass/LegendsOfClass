import gameData from '../data/game.json' with { type: 'json' };
import monsters from '../data/monsters.json' with { type: 'json' };
import type { MonsterDef, UnitSnapshot, GoverningStat } from '../types/core.js';

const MG = gameData.monsterGen;
type ArchetypeKey = keyof typeof MG.archetypes;

export function monsterDef(id: string): MonsterDef {
  const def = (monsters as Record<string, MonsterDef>)[id];
  if (!def) throw new Error(`Unknown monster: ${id}`);
  return def;
}

export function monsterSnapshot(id: string, instanceNo: number): UnitSnapshot {
  const def = monsterDef(id);
  const arch = MG.archetypes[def.archetype as ArchetypeKey];
  if (!arch) throw new Error(`Unknown archetype: ${def.archetype}`);
  const L = def.level;
  const atk = Math.floor((MG.atk.base + MG.atk.perLevel * L) * arch.atkMod);
  const attackStat = arch.attackStat as GoverningStat;
  return {
    id: `${id}#${instanceNo}`, nameKey: def.nameKey, side: 1, level: L,
    maxHp: Math.floor((MG.hp.base + MG.hp.perLevel * L) * arch.hpMod),
    patk: attackStat === 'PATK' ? atk : Math.floor(atk * 0.5),
    matk: attackStat === 'MATK' ? atk : Math.floor(atk * 0.5),
    def: Math.floor(MG.def.perLevel * L * arch.defMod),
    hit: Math.floor(MG.hit.base + MG.hit.perLevel * L),
    flee: Math.floor(MG.flee.perLevel * L),
    critRate: 5, critDmg: 150, spd: arch.spd,
    maxEnergy: 100, normalAttackStat: attackStat,
    prioritySkills: [def.signatureSkill ?? null, null, null, null],
    ultimateSkill: null,
  };
}

export function monsterRewards(id: string) {
  const L = monsterDef(id).level;
  return { exp: Math.floor(MG.exp.base + MG.exp.perLevel * L), gold: Math.floor(MG.gold.base + MG.gold.perLevel * L) };
}
