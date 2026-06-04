import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobsRepository } from './jobs.repository';
import { JobsService } from './jobs.service';

/**
 * Jobs domain. MediaModule and QueueModule are @Global, so the service can inject
 * MediaService + ProcessingQueueService without importing them here.
 */
@Module({
  controllers: [JobsController],
  providers: [JobsService, JobsRepository],
  exports: [JobsRepository],
})
export class JobsModule {}
