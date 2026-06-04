import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JobStatus } from '@prisma/client';
import { UnrecoverableError } from 'bullmq';
import { appConfig } from '../../config/configuration';
import { JobWithReport } from '../../jobs/job.mapper';
import { JobsRepository } from '../../jobs/jobs.repository';
import { ReportSectionInput } from '../../jobs/report.types';
import { severityToApi } from '../../jobs/severity';
import { MediaService, PDF_CONTENT_TYPE } from '../../media/media.service';
import { ProcessJobData } from '../../queue/queue.constants';
import { ReportCompilerService } from '../compiler/report-compiler.service';
import { PdfRendererService } from '../pdf/pdf-renderer.service';
import { ReportView } from '../pdf/report-html';
import { TranscriptionService } from '../transcription/transcription.service';

/** Stage names recorded on ProcessingEvent rows (one row per stage transition). */
const STAGE = {
  TRANSCRIBE: 'transcribe',
  COMPILE: 'compile',
  RENDER: 'render',
} as const;

/** An error flagged `permanent` skips BullMQ retries (e.g. empty/garbled input). */
function isPermanent(err: unknown): boolean {
  return Boolean((err as { permanent?: boolean })?.permanent) || err instanceof UnrecoverableError;
}

/**
 * The AI engine (handoff §8). Idempotent and resumable: each invocation reads
 * canonical state from Postgres, skips stages already completed, and walks the
 * status machine CREATED→…→READY/FAILED writing one ProcessingEvent per stage.
 * Re-running a READY job is a no-op. Throwing surfaces to the BullMQ processor,
 * which owns retry/DLQ policy; permanent failures are converted to
 * UnrecoverableError so they are not retried.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly media: MediaService,
    private readonly transcription: TranscriptionService,
    private readonly compiler: ReportCompilerService,
    private readonly pdf: PdfRendererService,
    @Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>,
  ) {}

  async process(data: ProcessJobData): Promise<void> {
    const job = await this.jobs.findById(data.jobId);
    if (!job) {
      this.logger.warn(`Job ${data.jobId} not found (deleted before processing); skipping.`);
      return;
    }
    if (job.deletedAt) {
      this.logger.warn(`Job ${data.jobId} is soft-deleted; skipping.`);
      return;
    }
    // Defense in depth: authorization precedes the idempotency short-circuit — a
    // payload whose owner doesn't match canonical state is an integrity violation
    // and must be rejected regardless of job status (never silently no-op'd).
    if (job.userId !== data.userId) {
      throw new UnrecoverableError(`Job ${data.jobId} owner mismatch; refusing to process.`);
    }
    if (job.status === JobStatus.READY) {
      this.logger.log(`Job ${data.jobId} already READY; no-op.`);
      return;
    }
    if (!job.audioKey) {
      throw new UnrecoverableError(`Job ${data.jobId} has no audio key; cannot process.`);
    }

    try {
      const transcript = await this.transcribeStage(data.jobId, job.audioKey, job.transcript);
      const sections = await this.compileStage(data.jobId, job.label, transcript, this.existingReport(job));
      await this.renderStage(data.jobId, data.userId, job.label, sections);
      this.logger.log(`Job ${data.jobId} pipeline complete → READY`);
    } catch (err) {
      if (isPermanent(err)) {
        const message = err instanceof Error ? err.message : String(err);
        // Mark FAILED now and stop retrying — the input itself is the problem.
        await this.markFailed(data.jobId, message);
        throw err instanceof UnrecoverableError ? err : new UnrecoverableError(message);
      }
      // Transient: leave status at the in-progress stage and let BullMQ retry.
      throw err;
    }
  }

  /**
   * Terminal failure handler. Idempotent: if the job is already FAILED (e.g. a
   * permanent error marked it inside process()), this is a no-op so the
   * processor's failure listener never writes a duplicate event.
   */
  async markFailed(jobId: string, message: string): Promise<void> {
    const job = await this.jobs.rawById(jobId);
    if (!job || job.status === JobStatus.FAILED) {
      return;
    }
    const trimmed = message.slice(0, 1000);
    await this.jobs.setStatus(jobId, JobStatus.FAILED, trimmed);
    await this.jobs.addEvent(jobId, 'pipeline', 'failed', trimmed);
  }

  /**
   * Project a job's persisted report tree into the normalized compiler shape,
   * preserving section/finding order. Empty when no prior attempt compiled — which
   * compileStage reads as "not yet done" (see its resumability note). Severity is the
   * same Prisma enum on both sides, so no conversion is needed.
   */
  private existingReport(job: JobWithReport): ReportSectionInput[] {
    return [...job.sections]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((section) => ({
        title: section.title,
        findings: [...section.findings]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((f) => ({ text: f.text, severity: f.severity })),
      }));
  }

  private async transcribeStage(
    jobId: string,
    audioKey: string,
    existingTranscript: string | null,
  ): Promise<string> {
    if (existingTranscript && existingTranscript.trim().length > 0) {
      this.logger.log(`Job ${jobId} already transcribed; reusing transcript.`);
      return existingTranscript;
    }
    return this.runStage(jobId, STAGE.TRANSCRIBE, JobStatus.TRANSCRIBING, async () => {
      const stream = await this.media.getObjectStream(audioKey);
      const transcript = await this.transcription.transcribe(stream, { filename: audioKey });
      await this.jobs.saveTranscript(jobId, transcript);
      return transcript;
    });
  }

  private async compileStage(
    jobId: string,
    label: string,
    transcript: string,
    existing: ReportSectionInput[],
  ): Promise<ReportSectionInput[]> {
    // Resumability: replaceReport is transactional, so a non-empty persisted report
    // means a prior attempt already compiled. Reuse it instead of re-invoking the
    // LLM (saves cost and avoids a non-deterministic second compilation on retry) —
    // the same skip-if-done contract as transcribeStage.
    if (existing.length > 0) {
      this.logger.log(`Job ${jobId} already compiled; reusing ${existing.length} section(s).`);
      return existing;
    }
    return this.runStage(jobId, STAGE.COMPILE, JobStatus.COMPILING, async () => {
      const sections = await this.compiler.compile({ label, transcript });
      await this.jobs.replaceReport(jobId, sections);
      return sections;
    });
  }

  private async renderStage(
    jobId: string,
    userId: string,
    label: string,
    sections: ReportSectionInput[],
  ): Promise<void> {
    await this.runStage(jobId, STAGE.RENDER, JobStatus.RENDERING, async () => {
      const view = this.toReportView(jobId, label, sections);
      const pdf = await this.pdf.render(view);
      const pdfKey = this.media.pdfKey(userId, jobId);
      await this.media.putObject(pdfKey, pdf, PDF_CONTENT_TYPE);
      await this.jobs.setPdfReady(jobId, pdfKey);
    });
  }

  private toReportView(jobId: string, label: string, sections: ReportSectionInput[]): ReportView {
    return {
      jobId,
      label,
      generatedAt: new Date(),
      sections: sections.map((section) => ({
        title: section.title,
        findings: section.findings.map((f) => ({
          text: f.text,
          severity: severityToApi(f.severity),
        })),
      })),
    };
  }

  /**
   * Run a stage with status transition, paired started/completed events, and a
   * hard timeout. A throw records a `failed` event for the stage and propagates.
   */
  private async runStage<T>(
    jobId: string,
    stage: string,
    status: JobStatus,
    fn: () => Promise<T>,
  ): Promise<T> {
    await this.jobs.setStatus(jobId, status);
    await this.jobs.addEvent(jobId, stage, 'started');
    try {
      const result = await withTimeout(fn(), this.cfg.ai.stageTimeoutMs, stage);
      await this.jobs.addEvent(jobId, stage, 'completed');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.jobs.addEvent(jobId, stage, 'failed', message.slice(0, 1000));
      throw err;
    }
  }
}

class StageTimeoutError extends Error {
  constructor(stage: string, ms: number) {
    super(`Stage "${stage}" exceeded ${ms}ms timeout`);
    this.name = 'StageTimeoutError';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, stage: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StageTimeoutError(stage, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
