import 'reflect-metadata';
import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { appConfig } from './config/configuration';
import { MediaService } from './media/media.service';
import { WorkerModule } from './processing/worker/worker.module';

/**
 * Worker process entrypoint (npm run start:worker). Boots a headless Nest
 * application context — no HTTP server — and lets ProcessingProcessor.onModuleInit
 * start the BullMQ Worker. Shutdown hooks drain the worker + Prisma cleanly on
 * SIGTERM (Railway sends this on redeploy).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.flushLogs();

  const cfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  app.enableShutdownHooks();

  // Dev/test convenience so a fresh LocalStack/MinIO has the bucket for PDF puts.
  if (!cfg.isProduction) {
    await app.get(MediaService).ensureBucketExists();
  }

  const logger = app.get(Logger);
  logger.log('Worker context booted; processing jobs.', 'WorkerBootstrap');
}

void bootstrap();
