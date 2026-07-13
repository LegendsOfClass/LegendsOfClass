import gameData from '../data/game.json' with { type: 'json' };
import type { PrimaryStats, GearBonus, GoverningStat } from '../types/core.js';

const SC = gameData.statConversion;

export interface DerivedStats {
  maxHp: number; patk: number; matk: number; def: number;
  hit: number; flee: number; critRate: number; critDmg: number;
  spd: number; maxEnergy: number;
}

/** docs/01-combat/02 — additive sources first, % layers after, floor once at the end. */
export function computeDerived(
  primary: PrimaryStats, level: number, gear: GearBonus, pctAll = 0,
): DerivedStats {
  const g = (n?: number) => n ?? 0;
  const mul = 1 + pctAll;
  return {
    patk: Math.floor((level * SC.patk.perLevel + primary.str * SC.patk.perStr + g(gear.patk)) * mul),
    matk: Math.floor((level * SC.matk.perLevel + primary.int * SC.matk.perInt + g(gear.matk)) * mul),
    maxHp: Math.floor((SC.maxHp.base + level * SC.maxHp.perLevel + primary.con * SC.maxHp.perCon + g(gear.hp)) * mul),
    def: Math.floor((primary.con * SC.def.perCon + g(gear.def)) * mul),
    hit: Math.floor(SC.hitAttr.base + primary.dex * SC.hitAttr.perDex),
    flee: Math.floor(level * SC.flee.perLevel + primary.dex * SC.flee.perDex),
    critRate: Math.min(gameData.combat.critRateCap, SC.critRate.base + primary.dex * SC.critRate.perDex) + g(gear.critRate),
    critDmg: SC.critDmg.base,
    spd: Math.floor(SC.spd.base + primary.dex * SC.spd.perDex + g(gear.spd)),
    maxEnergy: Math.floor(SC.maxEnergy.base + primary.int * SC.maxEnergy.perInt),
  };
}

export function normalAttackStatFor(stat: GoverningStat): 'patk' | 'matk' {
  return stat === 'PATK' ? 'patk' : 'matk';
}
