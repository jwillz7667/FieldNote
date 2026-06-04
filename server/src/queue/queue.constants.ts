/** Shared queue contract between the API (producer) and worker (consumer).
 *  BullMQ forbids ':' in queue names (it is the Redis key separator), so the
 *  names use '-'. Producer and consumer MUST agree on these exact strings. */
export const PROCESSING_QUEUE = 'fieldnote-processing';
export const PROCESSING_DLQ = 'fieldnote-processing-dlq';
export const PROCESS_JOB = 'process-job';

/** DI token for the injected BullMQ Queue instance (API side). */
export const PROCESSING_QUEUE_TOKEN = Symbol('PROCESSING_QUEUE_TOKEN');

/** Payload carried on a processing job. Kept minimal — the worker reads canonical
 *  state from Postgres, never trusting stale queue data. */
export interface ProcessJobData {
  jobId: string;
  userId: string;
}
