import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { MediaService } from '../media/media.service';
import { ProcessingQueueService } from '../queue/processing-queue.service';
import { PaginatedDto } from '../common/dto/pagination.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { CreateJobResponseDto, JobDto, PdfUrlDto } from './dto/job-response.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { jobToDto, JobWithReport } from './job.mapper';
import { JobsRepository } from './jobs.repository';
import { ReportSectionInput } from './report.types';
import { severityFromApi } from './severity';

/** Statuses that mean "the pipeline is already running"; re-triggering is a no-op. */
const IN_FLIGHT: ReadonlySet<JobStatus> = new Set([
  JobStatus.QUEUED,
  JobStatus.TRANSCRIBING,
  JobStatus.COMPILING,
  JobStatus.RENDERING,
]);

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly repo: JobsRepository,
    private readonly media: MediaService,
    private readonly queue: ProcessingQueueService,
  ) {}

  async create(
    userId: string,
    dto: CreateJobDto,
    idempotencyKey: string | null,
  ): Promise<CreateJobResponseDto> {
    if (idempotencyKey) {
      const existing = await this.repo.findByIdempotencyKey(userId, idempotencyKey);
      if (existing) {
        // Idempotent replay: same job, fresh upload URL.
        const upload = await this.media.presignAudioUpload(userId, existing.id);
        return { job: jobToDto(existing, null), audioUploadUrl: upload };
      }
    }

    const id = randomUUID();
    const audioKey = this.media.audioKey(userId, id);
    const job = await this.repo.createDraft({ id, userId, label: dto.label, audioKey, idempotencyKey });
    const upload = await this.media.presignAudioUpload(userId, id);
    this.logger.log({ userId, jobId: id }, 'Created draft job');
    return { job: jobToDto(job, null), audioUploadUrl: upload };
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<PaginatedDto<JobDto>> {
    const jobs = await this.repo.listScoped(userId, cursor, limit);
    const items = jobs.map((job) => jobToDto(job, null));
    const nextCursor = jobs.length === limit ? jobs[jobs.length - 1].id : null;
    return { items, nextCursor };
  }

  async findOne(userId: string, jobId: string): Promise<JobDto> {
    const job = await this.requireOwned(userId, jobId);
    return jobToDto(job, await this.maybePdfUrl(job));
  }

  async update(userId: string, jobId: string, dto: UpdateJobDto): Promise<JobDto> {
    await this.requireOwned(userId, jobId);

    if (dto.sections !== undefined) {
      const sections = this.toReportInput(dto.sections);
      await this.repo.replaceReportScoped(userId, jobId, dto.label, sections);
    } else if (dto.label !== undefined) {
      await this.repo.updateLabelScoped(userId, jobId, dto.label);
    }

    return this.findOne(userId, jobId);
  }

  async process(userId: string, jobId: string): Promise<JobDto> {
    const job = await this.requireOwned(userId, jobId);

    if (job.status === JobStatus.READY) {
      return jobToDto(job, await this.maybePdfUrl(job));
    }
    if (IN_FLIGHT.has(job.status)) {
      return jobToDto(job, null);
    }

    const audioKey = job.audioKey ?? this.media.audioKey(userId, jobId);
    const uploaded = await this.media.objectExists(audioKey);
    if (!uploaded) {
      throw new BadRequestException('Audio has not been uploaded yet.');
    }

    await this.repo.setStatus(jobId, JobStatus.QUEUED, null);
    await this.queue.enqueueProcessing({ jobId, userId });
    this.logger.log({ userId, jobId }, 'Queued job for processing');

    const refreshed = await this.repo.findScoped(userId, jobId);
    return jobToDto(refreshed ?? job, null);
  }

  async remove(userId: string, jobId: string): Promise<void> {
    const job = await this.requireOwned(userId, jobId);
    const { count } = await this.repo.softDeleteScoped(userId, jobId);
    if (count === 0) {
      throw new NotFoundException('Job not found.');
    }
    const keys = [job.audioKey, job.pdfKey].filter((k): k is string => Boolean(k));
    try {
      await this.media.deleteObjects(keys);
    } catch (err) {
      // Soft-delete already succeeded; object cleanup is best-effort + retryable.
      this.logger.warn({ jobId, err }, 'Failed to delete R2 objects on job delete');
    }
  }

  async getPdfUrl(userId: string, jobId: string): Promise<PdfUrlDto> {
    const job = await this.requireOwned(userId, jobId);
    if (job.status !== JobStatus.READY || !job.pdfKey) {
      throw new ConflictException('PDF is not ready for this job.');
    }
    const { url, expiresInSeconds } = await this.media.presignPdfDownload(job.pdfKey);
    return { url, expiresInSeconds };
  }

  private async requireOwned(userId: string, jobId: string): Promise<JobWithReport> {
    const job = await this.repo.findScoped(userId, jobId);
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    return job;
  }

  private async maybePdfUrl(job: JobWithReport): Promise<string | null> {
    if (job.status !== JobStatus.READY || !job.pdfKey) return null;
    const { url } = await this.media.presignPdfDownload(job.pdfKey);
    return url;
  }

  private toReportInput(sections: UpdateJobDto['sections']): ReportSectionInput[] {
    return (sections ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((s) => ({
        title: s.title,
        findings: s.findings
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((f) => ({ text: f.text, severity: severityFromApi(f.severity) })),
      }));
  }
}
