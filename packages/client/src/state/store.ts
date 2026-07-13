/** Client game-state store (Rule 4: Data layer). Server data is the truth; this is a cache. */
import { EventBus } from '../EventBus';
import { api } from '../net/api';
import { JOBS, ITEMS, GAME, computeDerived, expToNext, type PrimaryStats, type GearBonus } from '@loce/shared';

export interface JobRow {
  job_id: string; level: number; exp: number; rebirth_count: number;
  stat_str: number; stat_dex: number; stat_con: number; stat_int: number; unspent_points: number;
  priority_slots: (string | null)[];
}
export interface ItemRow { id: number; item_id: string; rarity: string; enhance_level: number; equipped_slot: string | null; }
export interface Profile {
  account: { id: number; username: string; display_name: string };
  state: { current_job_id: string; current_map: string; gold: number; diamond: number };
  jobs: JobRow[]; items: ItemRow[]; skillsUnlocked: string[]; dataVersion: string;
}

let profile: Profile | null = null;

export function getProfile() { return profile; }

export function activeJob(): JobRow | null {
  if (!profile) return null;
  return profile.jobs.find(j => j.job_id === profile!.state.current_job_id) ?? null;
}

export function primaryStats(j: JobRow): PrimaryStats {
  const b = JOBS[j.job_id].base;
  return { str: b.str + j.stat_str, dex: b.dex + j.stat_dex, con: b.con + j.stat_con, int: b.int + j.stat_int };
}

/** Mirrors server gearBonusFor (same config, same math) so the character sheet matches battles. */
export function clientGearBonus(items: ItemRow[]): GearBonus {
  const total: Required<GearBonus> = { patk: 0, matk: 0, def: 0, hp: 0, spd: 0, critRate: 0 };
  const rmult = GAME.rarity.statMult as Record<string, number>;
  for (const it of items) {
    if (!it.equipped_slot) continue;
    const def = ITEMS[it.item_id]; if (!def) continue;
    const m = (rmult[it.rarity] ?? 1) * (1 + 0.05 * it.enhance_level);
    total.patk += Math.floor((def.stats.patk ?? 0) * m);
    total.matk += Math.floor((def.stats.matk ?? 0) * m);
    total.def  += Math.floor((def.stats.def  ?? 0) * m);
    total.hp   += Math.floor((def.stats.hp   ?? 0) * m);
    total.spd  += Math.floor((def.stats.spd  ?? 0) * m);
    total.critRate += Math.floor((def.stats.critRate ?? 0) * m);
  }
  return total;
}

export function derivedForActive() {
  const j = activeJob();
  if (!j || !profile) return null;
  return computeDerived(primaryStats(j), j.level, clientGearBonus(profile.items));
}

export function expProgress() {
  const j = activeJob();
  if (!j) return { cur: 0, next: 1 };
  return { cur: j.exp, next: expToNext(j.level) };
}

/** Refresh profile from server and broadcast to UI + scenes. */
export async function refreshProfile(): Promise<Profile> {
  profile = await api<Profile>('/me');
  EventBus.emit('profile', profile);
  return profile;
}
export function clearProfile() { profile = null; EventBus.emit('profile', null); }
