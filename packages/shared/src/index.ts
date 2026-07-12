export * from './types/core.js';
export { simulate, getSkill } from './combat/engine.js';
export { mulberry32 } from './combat/rng.js';
export { computeDerived, normalAttackStatFor, type DerivedStats } from './formulas/stats.js';
export { expToNext, applyExp } from './formulas/exp.js';
export { monsterDef, monsterSnapshot, monsterRewards } from './formulas/monsters.js';

import gameJson from './data/game.json' with { type: 'json' };
import jobsJson from './data/jobs.json' with { type: 'json' };
import skillsJson from './data/skills.json' with { type: 'json' };
import monstersJson from './data/monsters.json' with { type: 'json' };
import itemsJson from './data/items.json' with { type: 'json' };
import mapsJson from './data/maps.json' with { type: 'json' };
import type { ItemDef, JobDef, MonsterDef, SkillDef } from './types/core.js';

export const GAME = gameJson;
export const JOBS = jobsJson as unknown as Record<string, JobDef>;
export const SKILLS = skillsJson as unknown as Record<string, SkillDef>;
export const MONSTERS = monstersJson as unknown as Record<string, MonsterDef>;
export const ITEMS = itemsJson as unknown as Record<string, ItemDef>;
export const MAPS = mapsJson as unknown as Record<string, {
  id: string; nameKey: string; kind: 'town' | 'field';
  rarityWeights?: Record<string, number>;
  nodes: { id: string; monsterId: string }[];
}>;
export const DATA_VERSION: string = gameJson.dataVersion;
