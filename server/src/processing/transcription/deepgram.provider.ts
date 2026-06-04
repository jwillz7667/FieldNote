import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { createClient, DeepgramClient } from '@deepgram/sdk';
import {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from './transcription-provider.interface';

/**
 * Deepgram Nova-3 batch transcription (handoff §8 primary). Smart formatting +
 * punctuation on; diarization off for v1. Best accuracy on noisy field audio.
 */
export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  private readonly logger = new Logger(DeepgramTranscriptionProvider.name);
  private readonly client: DeepgramClient;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = createClient(apiKey);
  }

  async transcribe(audio: Readable, opts: TranscriptionOptions): Promise<TranscriptionResult> {
    const { result, error } = await this.client.listen.prerecorded.transcribeFile(audio, {
      model: this.model,
      smart_format: true,
      punctuate: true,
      diarize: false,
      language: opts.language ?? 'en',
    });

    if (error) {
      throw new Error(`Deepgram transcription failed: ${error.message}`);
    }

    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    this.logger.debug(`Deepgram transcript length: ${transcript.length}`);
    return { text: transcript.trim() };
  }
}
