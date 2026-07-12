import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { startBattle } from '../services/battleService.js';
import { config } from '../config.js';

export async function battleRoutes(app: FastifyInstance) {
  app.post('/battle/start', {
    onRequest: [app.authenticate],
    config: { rateLimit: { max: config.devMode ? 600 : 12, timeWindow: '1 minute' } }, // docs/08-technical/04 (dev mode relaxed for testing)
  }, async (req) => {
    const { nodeId } = z.object({ nodeId: z.string().max(64) }).parse(req.body);
    return startBattle(req.user.accountId, nodeId);
  });
}
