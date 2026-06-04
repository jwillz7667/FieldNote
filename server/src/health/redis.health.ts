import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { appConfig } from '../config/configuration';

/** Readiness probe for Redis — pings with a short timeout so a wedged Redis fails fast. */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicator: HealthIndicatorService,
    @Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    const client = new Redis(this.cfg.redis.url, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    try {
      await client.connect();
      const pong: string = await client.ping();
      if (pong !== 'PONG') throw new Error(`unexpected ping reply: ${pong}`);
      return check.up();
    } catch (err) {
      return check.down({ message: err instanceof Error ? err.message : 'redis unreachable' });
    } finally {
      client.disconnect();
    }
  }
}
