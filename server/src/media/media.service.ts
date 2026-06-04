import { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { appConfig } from '../config/configuration';

/** Content-type pinned into the presigned PUT signature. The iOS uploader MUST
 *  send exactly this or R2 returns 403 (handoff §13). */
export const AUDIO_CONTENT_TYPE = 'audio/m4a';
export const PDF_CONTENT_TYPE = 'application/pdf';

export interface PresignedUpload {
  url: string;
  key: string;
  contentType: string;
  expiresInSeconds: number;
}

/**
 * Cloudflare R2 (S3-compatible) access. The API hands the device short-lived
 * presigned URLs; large audio never transits the API (handoff §7). Keys are
 * scoped by userId so one user's objects can't collide with another's.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>) {
    this.bucket = cfg.r2.bucket;
    this.client = new S3Client({
      region: 'auto',
      endpoint: cfg.r2.endpoint,
      forcePathStyle: cfg.r2.forcePathStyle,
      credentials: {
        accessKeyId: cfg.r2.accessKeyId,
        secretAccessKey: cfg.r2.secretAccessKey,
      },
      // AWS SDK v3's default (WHEN_SUPPORTED) bakes an x-amz-checksum-crc32 header
      // into presigned URLs; the device's actual upload body never matches that
      // precomputed checksum, so R2/S3 reject the PUT with 400. Cloudflare R2 also
      // does not support the new aws-chunked trailer checksums. WHEN_REQUIRED keeps
      // checksums off unless an operation mandates them — correct for presigning.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  audioKey(userId: string, jobId: string): string {
    return `audio/${userId}/${jobId}.m4a`;
  }

  pdfKey(userId: string, jobId: string): string {
    return `pdf/${userId}/${jobId}.pdf`;
  }

  async presignAudioUpload(userId: string, jobId: string): Promise<PresignedUpload> {
    const key = this.audioKey(userId, jobId);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: AUDIO_CONTENT_TYPE,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: this.cfg.r2.presignPutTtl });
    return { url, key, contentType: AUDIO_CONTENT_TYPE, expiresInSeconds: this.cfg.r2.presignPutTtl };
  }

  async presignPdfDownload(key: string): Promise<{ url: string; expiresInSeconds: number }> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const url = await getSignedUrl(this.client, command, { expiresIn: this.cfg.r2.presignGetTtl });
    return { url, expiresInSeconds: this.cfg.r2.presignGetTtl };
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (this.isNotFound(err)) return false;
      throw err;
    }
  }

  /** Streams an object body (used by the worker to feed STT without buffering). */
  async getObjectStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Object ${key} has no body`);
    return res.Body as Readable;
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Best-effort deletion of a job's objects (handoff §7: deleting a job deletes its objects). */
  async deleteObjects(keys: string[]): Promise<void> {
    const present = keys.filter((k) => k.length > 0);
    if (present.length === 0) return;
    await this.client.send(
      new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: present.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }

  /** Dev/test convenience: create the bucket if missing. No-op/guarded in prod. */
  async ensureBucketExists(): Promise<void> {
    if (this.cfg.isProduction) return;
    // Cloudflare R2 mandates region 'auto', but S3 CreateBucket validates the
    // region string ('auto' is rejected by LocalStack/S3). Object ops work fine
    // with 'auto'; only bucket creation needs a concrete region — so this dev-only
    // path uses a throwaway us-east-1 client and never affects the prod client.
    const admin = new S3Client({
      region: 'us-east-1',
      endpoint: this.cfg.r2.endpoint,
      forcePathStyle: this.cfg.r2.forcePathStyle,
      credentials: {
        accessKeyId: this.cfg.r2.accessKeyId,
        secretAccessKey: this.cfg.r2.secretAccessKey,
      },
    });
    try {
      await admin.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created bucket ${this.bucket}`);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return;
      this.logger.warn(`ensureBucketExists: ${name ?? String(err)}`);
    } finally {
      admin.destroy();
    }
  }

  private isNotFound(err: unknown): boolean {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
  }
}
