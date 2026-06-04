import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';
import { appConfig } from '../config/configuration';
import { PROCESS_JOB, PROCESSING_QUEUE_TOKEN, ProcessJobData } from './queue.constants';

/**
 * Producer side of the pipeline. Enqueues with the FieldNote job id as the BullMQ
 * job id so a re-trigger (network retry, double tap) is de-duplicated by BullMQ
 * rather than spawning duplicate work (handoff §10 idempotency).
 */
@Injectable()
export class ProcessingQueueService {
  private readonly logger = new Logger(ProcessingQueueService.name);

  constructor(
    @Inject(PROCESSING_QUEUE_TOKEN) private readonly queue: Queue<ProcessJobData>,
    @Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>,
  ) {}

  async enqueueProcessing(data: ProcessJobData): Promise<void> {
    // Stable jobId de-dupes double-taps/retries. An in-flight job is left alone;
    // a previously completed/failed job with the same id is cleared so a retry
    // (e.g. reprocessing a FAILED job) can run.
    const existing = await this.queue.getJob(data.jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
      } else {
        this.logger.log({ jobId: data.jobId, state }, 'Processing job already in flight — skipping enqueue');
        return;
      }
    }

    const opts: JobsOptions = {
      jobId: data.jobId,
      attempts: this.cfg.ai.jobMaxAttempts,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      // Keep failed jobs so they're inspectable; permanent failures are mirrored
      // to the DLQ by the worker.
      removeOnFail: false,
    };
    await this.queue.add(PROCESS_JOB, data, opts);
    this.logger.log({ jobId: data.jobId }, 'Enqueued processing job');
  }
}
