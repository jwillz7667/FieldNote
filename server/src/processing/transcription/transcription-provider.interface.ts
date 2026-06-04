import { Readable } from 'node:stream';

export interface TranscriptionOptions {
  language?: string;
  /** Original object key — lets a provider infer a filename/mimetype if it needs one. */
  filename?: string;
}

export interface TranscriptionResult {
  text: string;
}

/**
 * Swappable STT behind one interface (handoff §8). Implementations stream the
 * audio to the provider rather than buffering it in our process.
 */
export interface TranscriptionProvider {
  transcribe(audio: Readable, opts: TranscriptionOptions): Promise<TranscriptionResult>;
}

export const TRANSCRIPTION_PROVIDER = Symbol('TRANSCRIPTION_PROVIDER');
