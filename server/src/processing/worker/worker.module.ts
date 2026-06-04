import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { MediaModule } from '../../media/media.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ProcessingProcessor } from './processing.processor';

/**
 * Root module for the worker process (start:worker). Boots config + logging +
 * Prisma + media + the AI pipeline, then ProcessingProcessor spins up the BullMQ
 * Worker on init. Deliberately excludes HTTP/auth/queue-producer wiring — the
 * worker never serves requests.
 */
@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, MediaModule, PipelineModule],
  providers: [ProcessingProcessor],
})
export class WorkerModule {}
