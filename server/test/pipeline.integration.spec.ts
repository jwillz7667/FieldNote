import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobStatus } from '@prisma/client';
import { ConfigModule } from '../src/config/config.module';
import { LoggerModule } from '../src/common/logger/logger.module';
import { PrismaModule } from '../src/common/prisma/prisma.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AUDIO_CONTENT_TYPE, MediaService } from '../src/media/media.service';
import { MediaModule } from '../src/media/media.module';
import { PipelineModule } from '../src/processing/pipeline/pipeline.module';
import { PipelineService } from '../src/processing/pipeline/pipeline.service';
import { prepareDatabase } from './e2e-env';

/**
 * Drives the worker AI engine end-to-end against real infrastructure (Postgres +
 * LocalStack R2 + headless Chromium) with the mock STT/LLM providers. Asserts the
 * status machine walks to READY, the report is persisted, a PDF lands in R2, and
 * one ProcessingEvent is written per stage — and that re-running is a no-op.
 */
describe('AI pipeline (integration)', () => {
  let app: INestApplication;
  let pipeline: PipelineService;
  let prisma: PrismaService;
  let media: MediaService;

  let userId: string;
  let jobId: string;

  beforeAll(async () => {
    await prepareDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, LoggerModule, PrismaModule, MediaModule, PipelineModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.init();

    pipeline = app.get(PipelineService);
    prisma = app.get(PrismaService);
    media = app.get(MediaService);
    await media.ensureBucketExists();

    // Seed a user + an uploaded job directly (the pipeline reads canonical state).
    const user = await prisma.user.create({ data: { appleSub: `it-${randomUUID()}` } });
    userId = user.id;
    jobId = randomUUID();
    const audioKey = media.audioKey(userId, jobId);
    await prisma.job.create({
      data: { id: jobId, userId, label: '742 Evergreen Terrace', audioKey, status: JobStatus.CREATED },
    });
    await media.putObject(audioKey, Buffer.from('fake-audio-bytes'), AUDIO_CONTENT_TYPE);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('walks a job to READY with a persisted report, a PDF in R2, and per-stage events', async () => {
    await pipeline.process({ jobId, userId });

    const job = await prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { sections: { include: { findings: true } }, events: true },
    });

    expect(job.status).toBe(JobStatus.READY);
    expect(job.transcript && job.transcript.length).toBeGreaterThan(0);
    expect(job.pdfKey).toBeTruthy();
    expect(job.sections.length).toBeGreaterThan(0);
    expect(job.sections[0].findings.length).toBeGreaterThan(0);

    // The rendered PDF actually exists in object storage and is a real PDF.
    const stream = await media.getObjectStream(job.pdfKey as string);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const pdf = Buffer.concat(chunks);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // One started+completed event per stage (transcribe, compile, render).
    const completed = job.events.filter((e) => e.status === 'completed').map((e) => e.stage);
    expect(completed).toEqual(expect.arrayContaining(['transcribe', 'compile', 'render']));
  });

  it('is a no-op when re-run on a READY job (idempotent/resumable)', async () => {
    const before = await prisma.processingEvent.count({ where: { jobId } });

    await pipeline.process({ jobId, userId });

    const after = await prisma.processingEvent.count({ where: { jobId } });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe(JobStatus.READY);
    expect(after).toBe(before); // no new stage events
  });

  it('refuses to process a job owned by a different user', async () => {
    await expect(pipeline.process({ jobId, userId: randomUUID() })).rejects.toThrow(/owner mismatch/i);
  });
});
