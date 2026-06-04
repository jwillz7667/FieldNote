import type { ConnectionOptions } from 'bullmq';

/**
 * Build BullMQ connection options from a redis:// URL. We pass a plain options
 * object (not an ioredis instance) so BullMQ uses its own bundled ioredis and we
 * avoid dual-package type clashes. `maxRetriesPerRequest: null` is mandatory for
 * BullMQ workers (handoff §13).
 */
export function createBullConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const isTls = parsed.protocol === 'rediss:';
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(isTls ? { tls: {} } : {}),
  };
}
