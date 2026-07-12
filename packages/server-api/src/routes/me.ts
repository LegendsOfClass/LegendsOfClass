import type { FastifyInstance } from 'fastify';
import { loadProfile } from '../services/accountService.js';
import { DATA_VERSION } from '@loce/shared';

export async function meRoutes(app: FastifyInstance) {
  app.get('/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const profile = await loadProfile(req.user.accountId);
    if (!profile) return reply.code(404).send({ code: 404, messageKey: 'error.account.notFound' });
    return { ...profile, dataVersion: DATA_VERSION };
  });
}
