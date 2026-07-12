# BACKLOG — ideas & deferred work (Rule 9)
> Nothing in this file may be implemented during Version 1.0 unless explicitly approved
> and scheduled into a milestone.

## Deferred by milestone plan (approved scope, later milestone)
- [M2] Colyseus presence: see players, chat, channels
- [M3] Full T1 skill kits **including passives & ultimates** (Archer/Healer base+S1+Heal already shipped early per D-025), Priority Builder UI, cross-job P2–P4 (D-006), Map 2
- [M4] Fusion→T2, Mastery, Rebirth, enhancement UI, sets, monster cards, presets
- [M5] Maps 3–4, all 20 monsters, 4 minibosses, daily quests, tutorial gates, revive scrolls, potions (A-06), mixed monster groups, NPC shops (incl. selling items)
- [M6] Async PvP + Arena coins, World Boss + medals/leaderboard
- [M7] Cash shop (mock), full i18n pass, security hardening, client code-splitting/perf

## Art asset gaps (waiting on owner's image generator)
- **Wild Boar art** — Monster Bible tile labeled "Wild Boar" is a mushroom creature; using as-is until replacement PNG arrives (drop-in swap, no code change)
- Gate / town props art, Field background tiles — placeholders in use
- M3+: Archer/Healer sprites (exist in Job Bible, cut when M3 starts); skill/VFX atlas from VFX Bible; UI skin from UI Bible; equipment icons from Equipment Bible; card frames from Card Bible

## Ideas raised & parked (not in approved GDD)
- "Goblin" as a new monster — **rejected** for M1 (mapping A chose Wild Boar); could join the map-2 roster if desired
- Sound effects / background music (never specified in GDD scope for V1.0)
- Battle log text panel alongside the visual replay
- Password reset / email verification flow (accounts are username+password only in V1.0 docs)

## Tech debt / polish candidates
- Split Phaser into a separate lazy chunk (bundle currently ~1.6 MB)
- Structured logging + request ids surfaced to client error toasts
- Docker image for server-api (compose currently runs infra only)
- Vitest integration tests wrapping e2e.py logic in TypeScript
