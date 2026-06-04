import { execSync } from 'node:child_process';

/**
 * Shared harness for the integration + e2e suites. Both run the FULL stack
 * against local Docker infra (Postgres on 5544, Redis on 6399, LocalStack R2 on
 * 4566) with mock AI and Apple dev-bypass — no cloud credentials. Tests are
 * isolated in a dedicated Postgres schema that is dropped and re-migrated before
 * each suite, so they never touch the developer's `public` data.
 */
export const E2E_DB_SCHEMA = 'fieldnote_test';

const DEFAULT_DATABASE_URL = `postgresql://postgres:postgres@localhost:5544/fieldnote?schema=${E2E_DB_SCHEMA}`;
const DEFAULT_REDIS_URL = 'redis://localhost:6399';

/** Set deterministic test env. Behaviour flags are forced; infra URLs default
 *  to local Docker but may be overridden (e.g. CI service containers). */
export function applyE2EEnv(): void {
  const forced: Record<string, string> = {
    NODE_ENV: 'test',
    PORT: '8080',
    APP_BASE_URL: 'http://localhost:8080',
    LOG_LEVEL: 'silent',
    R2_ACCOUNT_ID: 'local',
    R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test',
    R2_BUCKET: 'fieldnote-test',
    R2_ENDPOINT: 'http://localhost:4566',
    R2_FORCE_PATH_STYLE: 'true',
    TRANSCRIPTION_PROVIDER: 'deepgram',
    USE_MOCK_AI: 'true',
    APPLE_CLIENT_ID: 'com.viralventures.fieldnote',
    APPLE_AUTH_DEV_BYPASS: 'true',
    JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdef',
    JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789abcdef',
    JWT_ACCESS_TTL: '900',
  };
  for (const [k, v] of Object.entries(forced)) {
    process.env[k] = v;
  }
  process.env.DATABASE_URL ??= DEFAULT_DATABASE_URL;
  process.env.REDIS_URL ??= DEFAULT_REDIS_URL;
}

/**
 * Drop + recreate the isolated schema and apply all migrations into it. Runs in
 * a suite's beforeAll so every run starts from a known-clean database.
 */
export async function prepareDatabase(): Promise<void> {
  applyE2EEnv();
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${E2E_DB_SCHEMA}" CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${E2E_DB_SCHEMA}"`);
  } finally {
    await prisma.$disconnect();
  }
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}
