import gameData from '../data/game.json' with { type: 'json' };
const P = gameData.progression;

/** EXP needed to go from level L to L+1 (docs/03-progression/02). */
export function expToNext(level: number): number {
  return Math.floor(P.expBase * Math.pow(level, P.expExponent));
}

/** Apply exp; returns new level/exp and levels gained. Exp at max level is discarded. */
export function applyExp(level: number, exp: number, gained: number) {
  let lv = level, xp = exp + gained, gainedLevels = 0;
  while (lv < P.maxJobLevel && xp >= expToNext(lv)) {
    xp -= expToNext(lv); lv++; gainedLevels++;
  }
  if (lv >= P.maxJobLevel) xp = 0;
  return { level: lv, exp: xp, levelsGained: gainedLevels, statPointsGained: gainedLevels * P.statPointsPerLevel };
}
