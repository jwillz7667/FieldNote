import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { appConfig } from '../../config/configuration';

/**
 * Single Prisma client for the process. The connection pool is sized in the
 * DATABASE_URL (`connection_limit`) to match worker concurrency vs Postgres
 * max_connections (handoff §6/§13).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(appConfig.KEY) cfg: ConfigType<typeof appConfig>) {
    super({
      datasources: { db: { url: cfg.database.url } },
      log: cfg.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
