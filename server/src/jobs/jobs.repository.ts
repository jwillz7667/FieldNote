import { Injectable } from '@nestjs/common';
import { Job, JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { JOB_REPORT_INCLUDE, JobWithReport } from './job.mapper';
import { ReportSectionInput } from './report.types';

/**
 * All Job/section/finding/event persistence. User-scoped methods take `userId`
 * and bake it into the WHERE clause so a user can never touch another's job
 * (handoff §5/§9). Worker-side methods are keyed by jobId only (trusted internal).
 */
@Injectable()
export class JobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────── API (user-scoped) ─────────────────────────

  async createDraft(params: {
    id: string;
    userId: string;
    label: string;
    audioKey: string;
    idempotencyKey: string | null;
  }): Promise<JobWithReport> {
    return this.prisma.job.create({
      data: {
        id: params.id,
        userId: params.userId,
        label: params.label,
        audioKey: params.audioKey,
        idempotencyKey: params.idempotencyKey,
        status: JobStatus.CREATED,
      },
      include: JOB_REPORT_INCLUDE,
    });
  }

  async findByIdempotencyKey(userId: string, idempotencyKey: string): Promise<JobWithReport | null> {
    return this.prisma.job.findFirst({
      where: { userId, idempotencyKey, deletedAt: null },
      include: JOB_REPORT_INCLUDE,
    });
  }

  async findScoped(userId: string, jobId: string): Promise<JobWithReport | null> {
    return this.prisma.job.findFirst({
      where: { id: jobId, userId, deletedAt: null },
      include: JOB_REPORT_INCLUDE,
    });
  }

  /** Cursor page (createdAt desc, id tiebreak) of a user's non-deleted jobs. */
  async listScoped(userId: string, cursor: string | undefined, limit: number): Promise<JobWithReport[]> {
    return this.prisma.job.findMany({
      where: { userId, deletedAt: null },
      include: JOB_REPORT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async updateLabelScoped(userId: string, jobId: string, label: string): Promise<void> {
    await this.prisma.job.updateMany({ where: { id: jobId, userId, deletedAt: null }, data: { label } });
  }

  /** Replace the report tree for a user-owned job and bump updatedAt (LWW). */
  async replaceReportScoped(
    userId: string,
    jobId: string,
    label: string | undefined,
    sections: ReportSectionInput[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const owned = await tx.job.findFirst({ where: { id: jobId, userId, deletedAt: null }, select: { id: true } });
      if (!owned) {
        throw new Prisma.PrismaClientKnownRequestError('Job not found', {
          code: 'P2025',
          clientVersion: Prisma.prismaVersion.client,
        });
      }
      await tx.finding.deleteMany({ where: { section: { jobId } } });
      await tx.reportSection.deleteMany({ where: { jobId } });
      await this.insertSections(tx, jobId, sections);
      // userId is redundant given the ownership check above, but keeping it in the
      // WHERE clause makes every mutation in this file self-evidently user-scoped.
      await tx.job.update({
        where: { id: jobId, userId },
        data: { ...(label !== undefined ? { label } : {}), updatedAt: new Date() },
      });
    });
  }

  async softDeleteScoped(userId: string, jobId: string): Promise<{ count: number }> {
    const res = await this.prisma.job.updateMany({
      where: { id: jobId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { count: res.count };
  }

  // ───────────────────────────── Worker (by jobId) ─────────────────────────

  async findById(jobId: string): Promise<JobWithReport | null> {
    return this.prisma.job.findUnique({ where: { id: jobId }, include: JOB_REPORT_INCLUDE });
  }

  async setStatus(jobId: string, status: JobStatus, errorMessage?: string | null): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { status, ...(errorMessage !== undefined ? { errorMessage } : {}) },
    });
  }

  async saveTranscript(jobId: string, transcript: string): Promise<void> {
    await this.prisma.job.update({ where: { id: jobId }, data: { transcript } });
  }

  /** Persist a freshly compiled report, replacing any prior sections. */
  async replaceReport(jobId: string, sections: ReportSectionInput[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.finding.deleteMany({ where: { section: { jobId } } });
      await tx.reportSection.deleteMany({ where: { jobId } });
      await this.insertSections(tx, jobId, sections);
    });
  }

  async setPdfReady(jobId: string, pdfKey: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { pdfKey, status: JobStatus.READY, errorMessage: null },
    });
  }

  async addEvent(jobId: string, stage: string, status: string, message?: string): Promise<void> {
    await this.prisma.processingEvent.create({
      data: { jobId, stage, status, message: message ?? null },
    });
  }

  async rawById(jobId: string): Promise<Job | null> {
    return this.prisma.job.findUnique({ where: { id: jobId } });
  }

  private async insertSections(
    tx: Prisma.TransactionClient,
    jobId: string,
    sections: ReportSectionInput[],
  ): Promise<void> {
    for (let s = 0; s < sections.length; s++) {
      const section = sections[s];
      const created = await tx.reportSection.create({
        data: { jobId, title: section.title, sortOrder: s },
      });
      if (section.findings.length > 0) {
        await tx.finding.createMany({
          data: section.findings.map((f, i) => ({
            sectionId: created.id,
            text: f.text,
            severity: f.severity,
            sortOrder: i,
          })),
        });
      }
    }
  }
}
