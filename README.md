# Legends of Class Evolution — Milestone 1 (Vertical Slice)

Online 2D fantasy auto-battle RPG. Server-authoritative, deterministic combat, data-driven balance.

## Run locally
```bash
# 1) infra (or use a local PostgreSQL 16 with user/db "loce")
docker compose up -d postgres redis

# 2) install + build shared
npm install
npm run build -w @loce/shared

# 3) database
DATABASE_URL=postgres://loce:loce@localhost:5432/loce npm run db:migrate

# 4) API  (DEV_MODE enables /dev tools — never in production)
cd packages/server-api
PORT=3000 DEV_MODE=true DATABASE_URL=postgres://loce:loce@localhost:5432/loce JWT_SECRET=dev npx tsx src/index.ts

# 5) client
cd packages/client && npx vite     # http://localhost:5173
```

## Tests
```bash
npm test                    # shared engine unit tests (13)
python3 e2e.py              # full API vertical-slice E2E (17 checks, API on :3000)
```

## Layout
- `packages/shared` — types, balance JSON (all tunables), formulas, deterministic combat engine
- `packages/server-api` — Fastify REST, PostgreSQL, auth, battles, items, dev tools
- `packages/client` — Phaser 3 scenes + React UI (EventBus bridge), i18n th/en
- `database/` — SQL migrations + runner · `docs/` — GDD + implementation notes · `BACKLOG.md`
