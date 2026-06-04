import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import { appConfig } from '../../config/configuration';
import { PROCESSING_DLQ, PROCESSING_QUEUE, ProcessJobData } from '../../queue/queue.constants';
import { createBullConnection } from '../../queue/redis.connection';
import { PipelineService } from '../pipeline/pipeline.service';

/**
 * The consumer half of P5. Owns a BullMQ Worker bound to the processing queue and
 * the retry/DLQ policy. The actual work lives in PipelineService; this class is
 * the transport adapter: it translates BullMQ lifecycle into terminal-failure
 * handling (mark FAILED + park on the DLQ) when retries are exhausted or the
 * error is unrecoverable. Only the worker process instantiates this.
 */
@Injectable()
export class ProcessingProcessor implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ProcessingProcessor.name);
  private worker: Worker<ProcessJobData> | null = null;
  private dlq: Queue | null = null;

  constructor(
    private readonly pipeline: PipelineService,
    @Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>,
  ) {}

  onModuleInit(): void {
    this.dlq = new Queue(PROCESSING_DLQ, { connection: createBullConnection(this.cfg.redis.url) });
    this.worker = new Worker<ProcessJobData>(
      PROCESSING_QUEUE,
      async (job) => {
        await this.pipeline.process(job.data);
      },
      {
        connection: createBullConnection(this.cfg.redis.url),
        concurrency: this.cfg.ai.workerConcurrency,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.data.jobId} completed`);
    });
    this.worker.on('failed', (job, err) => {
      void this.handleFailure(job, err);
    });
    this.worker.on('error', (err) => {
      this.logger.error(`Worker transport error: ${err.message}`);
    });

    this.logger.log(
      `Processing worker started (queue=${PROCESSING_QUEUE}, concurrency=${this.cfg.ai.workerConcurrency})`,
    );
  }

  private async handleFailure(job: Job<ProcessJobData> | undefined, err: Error): Promise<void> {
    if (!job) {
      this.logger.error(`A job failed with no job reference: ${err.message}`);
      return;
    }
    const maxAttempts = job.opts.attempts ?? 1;
    // err.name survives BullMQ's error reconstruction; instanceof may not.
    const unrecoverable = err instanceof UnrecoverableError || err.name === 'UnrecoverableError';
    const terminal = unrecoverable || job.attemptsMade >= maxAttempts;

    this.logger.warn(
      `Job ${job.data.jobId} failed (attempt ${job.attemptsMade}/${maxAttempts}, terminal=${terminal}): ${err.message}`,
    );
    if (!terminal) {
      return; // BullMQ will retry with backoff.
    }

    try {
      await this.pipeline.markFailed(job.data.jobId, err.message);
      await this.dlq?.add(
        'failed-job',
        {
          jobId: job.data.jobId,
          userId: job.data.userId,
          error: err.message,
          attemptsMade: job.attemptsMade,
        },
        { removeOnComplete: false, removeOnFail: false },
      );
    } catch (recordErr) {
      this.logger.error(
        `Failed to record terminal failure for ${job.data.jobId}: ${(recordErr as Error).message}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.dlq?.close();
  }
}
