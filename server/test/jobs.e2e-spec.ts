import 'reflect-metadata';
import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AUDIO_CONTENT_TYPE, MediaService } from '../src/media/media.service';
import { prepareDatabase } from './e2e-env';

/**
 * Full-stack HTTP contract for the jobs domain. The security-critical invariants
 * (deny-by-default auth, strict per-user scoping, idempotent create) are asserted
 * over the wire against the real app + database.
 */
describe('Jobs API (e2e)', () => {
  let app: INestApplication;
  let media: MediaService;

  const server = (): Server => app.getHttpServer() as Server;

  // Dev-bypass: a bare identityToken string becomes the stable Apple subject.
  async function signIn(subject: string): Promise<{ token: string; userId: string }> {
    const res = await request(server())
      .post('/auth/apple')
      .send({ identityToken: subject })
      .expect(200);
    return { token: res.body.accessToken, userId: res.body.userId };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await prepareDatabase();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    media = app.get(MediaService);
    await media.ensureBucketExists();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects unauthenticated access to a protected route', async () => {
    await request(server()).get('/jobs').expect(401);
  });

  it('issues app tokens for a (dev-bypass) Apple sign-in', async () => {
    const { token, userId } = await signIn('e2e-user-alice');
    expect(typeof token).toBe('string');
    expect(userId).toMatch(/[0-9a-f-]{36}/);
  });

  it('creates a job idempotently and returns a presigned upload URL', async () => {
    const { token } = await signIn('e2e-user-idem');

    const first = await request(server())
      .post('/jobs')
      .set(auth(token))
      .set('Idempotency-Key', 'key-123')
      .send({ label: '123 Main St' })
      .expect(201);

    expect(first.body.job.label).toBe('123 Main St');
    expect(first.body.job.status).toBe('CREATED');
    expect(first.body.audioUploadUrl.url).toContain('http');
    expect(first.body.audioUploadUrl.contentType).toBe(AUDIO_CONTENT_TYPE);

    const replay = await request(server())
      .post('/jobs')
      .set(auth(token))
      .set('Idempotency-Key', 'key-123')
      .send({ label: 'changed-but-ignored' })
      .expect(201);

    // Same key → same job, no duplicate row.
    expect(replay.body.job.id).toBe(first.body.job.id);
    expect(replay.body.job.label).toBe('123 Main St');
  });

  it('rejects an invalid create body (validation)', async () => {
    const { token } = await signIn('e2e-user-idem');
    await request(server())
      .post('/jobs')
      .set(auth(token))
      .send({ label: '', extraneous: true })
      .expect(400);
  });

  it('scopes lists and reads strictly per user', async () => {
    const alice = await signIn('e2e-user-alice');
    const bob = await signIn('e2e-user-bob');

    const created = await request(server())
      .post('/jobs')
      .set(auth(alice.token))
      .send({ label: "Alice's house" })
      .expect(201);
    const jobId = created.body.job.id;

    const aliceList = await request(server()).get('/jobs').set(auth(alice.token)).expect(200);
    expect(aliceList.body.items.some((j: { id: string }) => j.id === jobId)).toBe(true);

    const bobList = await request(server()).get('/jobs').set(auth(bob.token)).expect(200);
    expect(bobList.body.items.some((j: { id: string }) => j.id === jobId)).toBe(false);

    // Bob cannot read Alice's job — 404 (existence is not leaked).
    await request(server()).get(`/jobs/${jobId}`).set(auth(bob.token)).expect(404);
    // Bob cannot mutate or delete it either.
    await request(server()).patch(`/jobs/${jobId}`).set(auth(bob.token)).send({ label: 'hijack' }).expect(404);
    await request(server()).delete(`/jobs/${jobId}`).set(auth(bob.token)).expect(404);

    // Alice still owns an untouched job.
    const reread = await request(server()).get(`/jobs/${jobId}`).set(auth(alice.token)).expect(200);
    expect(reread.body.label).toBe("Alice's house");
  });

  it('refuses to enqueue processing before audio is uploaded, then enqueues once it exists', async () => {
    const { token } = await signIn('e2e-user-proc');
    const created = await request(server())
      .post('/jobs')
      .set(auth(token))
      .send({ label: 'Process me' })
      .expect(201);
    const jobId = created.body.job.id;
    const audioKey: string = created.body.audioUploadUrl.key;

    // No audio object yet → 400.
    await request(server()).post(`/jobs/${jobId}/process`).set(auth(token)).expect(400);

    // Simulate the device upload by putting the object straight into R2.
    await media.putObject(audioKey, Buffer.from('fake-audio-bytes'), AUDIO_CONTENT_TYPE);

    const processed = await request(server()).post(`/jobs/${jobId}/process`).set(auth(token)).expect(200);
    expect(processed.body.status).toBe('QUEUED');

    // PDF is not ready while the job is queued → 409.
    await request(server()).get(`/jobs/${jobId}/pdf`).set(auth(token)).expect(409);
  });

  it('replaces the report tree on PATCH (last-write-wins edit)', async () => {
    const { token } = await signIn('e2e-user-edit');
    const created = await request(server())
      .post('/jobs')
      .set(auth(token))
      .send({ label: 'Editable' })
      .expect(201);
    const jobId = created.body.job.id;

    const patched = await request(server())
      .patch(`/jobs/${jobId}`)
      .set(auth(token))
      .send({
        label: 'Edited label',
        sections: [
          {
            title: 'Roof',
            sortOrder: 0,
            findings: [
              { text: 'Cracked flashing', severity: 'repair', sortOrder: 0 },
              { text: 'Aging shingles', severity: 'maintenance', sortOrder: 1 },
            ],
          },
        ],
      })
      .expect(200);

    expect(patched.body.label).toBe('Edited label');
    expect(patched.body.sections).toHaveLength(1);
    expect(patched.body.sections[0].title).toBe('Roof');
    expect(patched.body.sections[0].findings).toHaveLength(2);
    expect(patched.body.sections[0].findings[0].severity).toBe('repair');
  });

  it('soft-deletes a job so it is no longer retrievable', async () => {
    const { token } = await signIn('e2e-user-del');
    const created = await request(server())
      .post('/jobs')
      .set(auth(token))
      .send({ label: 'Delete me' })
      .expect(201);
    const jobId = created.body.job.id;

    await request(server()).delete(`/jobs/${jobId}`).set(auth(token)).expect(204);
    await request(server()).get(`/jobs/${jobId}`).set(auth(token)).expect(404);
  });
});
