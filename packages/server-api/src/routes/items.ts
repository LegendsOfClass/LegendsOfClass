import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tx } from '../db/pool.js';
import { ITEMS } from '@loce/shared';
import { httpError } from '../services/battleService.js';

export async function itemRoutes(app: FastifyInstance) {
  app.post('/items/equip', { onRequest: [app.authenticate] }, async (req) => {
    const { itemDbId } = z.object({ itemDbId: z.number().int().positive() }).parse(req.body);
    return tx(async (c) => {
      const r = await c.query('SELECT item_id FROM items WHERE id=$1 AND account_id=$2 FOR UPDATE', [itemDbId, req.user.accountId]);
      if (!r.rowCount) throw httpError(404, 'error.item.notFound');
      const def = ITEMS[r.rows[0].item_id];
      if (!def) throw httpError(400, 'error.item.unknown');
      // unequip whatever occupies the slot, then equip (slot derived server-side from item data)
      await c.query('UPDATE items SET equipped_slot=NULL WHERE account_id=$1 AND equipped_slot=$2', [req.user.accountId, def.slot]);
      await c.query('UPDATE items SET equipped_slot=$3 WHERE id=$1 AND account_id=$2', [itemDbId, req.user.accountId, def.slot]);
      return { ok: true, slot: def.slot };
    });
  });

  app.post('/items/unequip', { onRequest: [app.authenticate] }, async (req) => {
    const { slot } = z.object({ slot: z.string().max(16) }).parse(req.body);
    return tx(async (c) => {
      await c.query('UPDATE items SET equipped_slot=NULL WHERE account_id=$1 AND equipped_slot=$2', [req.user.accountId, slot]);
      return { ok: true };
    });
  });
}
