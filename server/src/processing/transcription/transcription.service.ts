import { Inject, Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  TRANSCRIPTION_PROVIDER,
  TranscriptionOptions,
  TranscriptionProvider,
} from './transcription-provider.interface';

/**
 * Thin orchestration seam over the configured STT provider (handoff §8). The
 * concrete provider is selected once at module construction; this service owns
 * logging and the empty-transcript invariant so the pipeline stage stays lean.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  constructor(
    @Inject(TRANSCRIPTION_PROVIDER) private readonly provider: TranscriptionProvider,
  ) {}

  async transcribe(audio: Readable, opts: TranscriptionOptions = {}): Promise<string> {
    const { text } = await this.provider.transcribe(audio, opts);
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      // A silent/empty recording is a clean, non-retryable failure: there is
      // nothing to compile. The pipeline surfaces this as a FAILED job.
      throw new EmptyTranscriptError();
    }
    this.logger.log(`Transcription produced ${trimmed.length} characters`);
    return trimmed;
  }
}

export class EmptyTranscriptError extends Error {
  readonly permanent = true;
  constructor() {
    super('Transcription produced no text — the recording appears to be silent or empty.');
    this.name = 'EmptyTranscriptError';
  }
}
