import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import { appConfig } from '../config/configuration';
import { ProcessingQueueService } from './processing-queue.service';
import { PROCESSING_QUEUE, PROCESSING_QUEUE_TOKEN, ProcessJobData } from './queue.constants';
import { createBullConnection } from './redis.connection';

/**
 * Producer-side queue wiring for the API service. The worker service builds its
 * own BullMQ Worker (see processing module) against the same queue name.
 */
@Global()
@Module({
  providers: [
    {
      provide: PROCESSING_QUEUE_TOKEN,
      inject: [appConfig.KEY],
      useFactory: (cfg: ConfigType<typeof appConfig>) =>
        new Queue<ProcessJobData>(PROCESSING_QUEUE, {
          connection: createBullConnection(cfg.redis.url),
        }),
    },
    ProcessingQueueService,
  ],
  exports: [ProcessingQueueService, PROCESSING_QUEUE_TOKEN],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(PROCESSING_QUEUE_TOKEN) private readonly queue: Queue<ProcessJobData>,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
