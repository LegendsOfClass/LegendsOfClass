import type { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import { config } from '../config.js';

declare module '@fastify/jwt' {
  interface FastifyJWT { user: { accountId: number } }
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '12h' } });
  app.decorate('authenticate', async (req: FastifyRequest) => {
    await req.jwtVerify();
  });
}

declare module 'fastify' {
  interface FastifyInstance { authenticate: (req: FastifyRequest) => Promise<void> }
}
