/** Core shared types — the single contract across client and server (D-017). */

export type School = 'physical' | 'magic' | 'heal' | 'buff' | 'debuff';
export type GoverningStat = 'PATK' | 'MATK';
export type SkillKind = 'normal' | 'skill' | 'passive' | 'ultimate';
export type Targeting = 'lowestHpEnemy' | 'self' | 'lowestHpAlly' | 'allEnemies' | 'randomEnemies' | 'highestAtkEnemy';

export type ModStat = 'patk' | 'matk' | 'def' | 'hit' | 'flee' | 'critRate' | 'critDmg' | 'spd';

export type EffectDef =
  | { type: 'statMod'; stat: ModStat; flat?: number; pct?: number; duration: number }
  | { type: 'dot'; stat: GoverningStat; mult: number; interval: number; duration: number }
  | { type: 'cleanse' }
  | { type: 'ignoreDefPct'; value: number }
  | { type: 'bonusCritRate'; value: number }
  | { type: 'healingDealtPct'; value: number };

export interface SkillDef {
  id: string;
  job: string;               // owning job id, '*' = generic, 'monster' = monster-only
  unlockLevel: number;
  kind: SkillKind;
  school: School;
  governingStat: GoverningStat;
  multiplier: number;
  hits: number;
  cooldown: number;          // ticks
  targeting: Targeting;
  targetCount?: number;      // for randomEnemies
  castCondition: string;     // 'always' | 'selfHp<=N' | 'targets>=N' | 'allyHp<=N' | 'selfHasDebuff'
  effects?: EffectDef[];
}

export interface PrimaryStats { str: number; dex: number; con: number; int: number; }

export interface GearBonus { patk?: number; matk?: number; def?: number; hp?: number; spd?: number; critRate?: number; }

/** Frozen at battle start — engine consumes only this (01-combat/02). */
export interface UnitSnapshot {
  id: string;
  nameKey: string;
  side: 0 | 1;               // 0 = player side, 1 = enemy side
  level: number;
  maxHp: number;
  patk: number;
  matk: number;
  def: number;
  hit: number;
  flee: number;
  critRate: number;          // percent
  critDmg: number;           // percent (150 = 1.5x)
  spd: number;
  maxEnergy: number;
  normalAttackStat: GoverningStat;
  /** Bonus healing dealt fraction (e.g. 0.2 from Divine Grace). */
  healingPct?: number;
  /** P1..P4 skill ids; null = empty slot (01-combat/05). */
  prioritySkills: (string | null)[];
  ultimateSkill: string | null;
}

export interface BattleRules { maxTicks: number; }

export interface BattleSetup {
  seed: number;
  dataVersion: string;
  units: UnitSnapshot[];
  rules: BattleRules;
}

export type BattleOutcome = 'victory' | 'defeat' | 'timeout';

export type BattleEvent =
  | { tick: number; type: 'action'; actor: string; skillId: string }
  | { tick: number; type: 'damage'; actor: string; target: string; skillId: string; value: number; crit: boolean; miss: boolean; targetHp: number }
  | { tick: number; type: 'heal'; actor: string; target: string; skillId: string; value: number; crit: boolean; targetHp: number }
  | { tick: number; type: 'buff'; actor: string; target: string; skillId: string; debuff: boolean }
  | { tick: number; type: 'death'; target: string }
  | { tick: number; type: 'end'; outcome: BattleOutcome };

export interface SimResult {
  outcome: BattleOutcome;
  ticks: number;
  events: BattleEvent[];
  damageDealt: Record<string, number>;
  hpRemaining: Record<string, number>;
  checksum: number;
}

/** Server -> client battle response payload. */
export interface BattleResponse {
  battleId: string;
  setup: BattleSetup;
  outcome: BattleOutcome;
  checksum: number;
  rewards: {
    exp: number;
    gold: number;
    levelsGained: number;
    newLevel: number;
    drops: { itemId: string; rarity: string; dbId: number }[];
  };
}

export interface JobDef {
  id: string;
  tier: number;
  nameKey: string;
  base: PrimaryStats;
  normalAttackStat: GoverningStat;
}

export interface MonsterDef {
  id: string;
  nameKey: string;
  level: number;
  archetype: string;
  signatureSkill: string;
  map: string;
}

export interface ItemDef {
  id: string;
  nameKey: string;
  slot: 'weapon' | 'helmet' | 'armor' | 'pants' | 'shoes' | 'gloves';
  stats: GearBonus;
  sourceMaps: string[];
}
