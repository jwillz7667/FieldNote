import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from './transcription-provider.interface';

/**
 * OpenAI batch transcription (handoff §8 alternative). Selected when
 * TRANSCRIPTION_PROVIDER=openai. Streams the audio into a File without buffering
 * the whole object in our heap first (toFile consumes the stream).
 */
export class OpenAiTranscriptionProvider implements TranscriptionProvider {
  private readonly logger = new Logger(OpenAiTranscriptionProvider.name);
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(audio: Readable, opts: TranscriptionOptions): Promise<TranscriptionResult> {
    const file = await toFile(audio, opts.filename ?? 'audio.m4a', { type: 'audio/m4a' });
    const response = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: opts.language,
      response_format: 'text',
    });
    // response_format: 'text' makes the SDK resolve to a plain string.
    const text = typeof response === 'string' ? response : '';
    this.logger.debug(`OpenAI transcript length: ${text.length}`);
    return { text: text.trim() };
  }
}
