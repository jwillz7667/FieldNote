import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../common/prisma/prisma.service';

/** Readiness probe for Postgres — a trivial round-trip query. */
@Injectable()
export class PrismaHealthIndicator {
  constructor(
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return check.up();
    } catch (err) {
      return check.down({ message: err instanceof Error ? err.message : 'postgres unreachable' });
    }
  }
}
