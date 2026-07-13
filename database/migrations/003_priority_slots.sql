-- M3: player-configured Priority Slots per job (docs/01-combat/05, D-006/D-007)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority_slots JSONB NOT NULL DEFAULT '[null,null,null,null]'::jsonb;
