import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { appConfig } from './config/configuration';
import { MediaService } from './media/media.service';
import { mountBullBoard } from './queue/bull-board';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.flushLogs();

  const cfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);

  app.use(helmet());
  app.enableCors({
    origin: cfg.corsOrigins.includes('*') ? true : cfg.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  setupSwagger(app);
  mountBullBoard(app, cfg);

  // Dev/test convenience so a fresh LocalStack/MinIO has the bucket.
  if (!cfg.isProduction) {
    await app.get(MediaService).ensureBucketExists();
  }

  await app.listen(cfg.port, '0.0.0.0');
  const logger = app.get(Logger);
  logger.log(`API listening on :${cfg.port} (docs at ${cfg.appBaseUrl}/docs)`, 'Bootstrap');
}

void bootstrap();
