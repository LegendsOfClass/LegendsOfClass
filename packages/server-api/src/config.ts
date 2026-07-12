import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://loce:loce@localhost:5432/loce',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret',
  /** Rule 6: Developer Mode. NEVER true in release. Hard-blocked in production below. */
  devMode: process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  /** Production deploys serve the built client from this same server (single free service). */
  serveClient: process.env.SERVE_CLIENT === 'true',
};
