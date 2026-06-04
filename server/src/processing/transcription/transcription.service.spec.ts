import { Readable } from 'node:stream';
import {
  EmptyTranscriptError,
  TranscriptionService,
} from './transcription.service';
import {
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from './transcription-provider.interface';

class FakeProvider implements TranscriptionProvider {
  lastOpts?: TranscriptionOptions;
  constructor(private readonly text: string) {}
  transcribe(_audio: Readable, opts: TranscriptionOptions): Promise<TranscriptionResult> {
    this.lastOpts = opts;
    return Promise.resolve({ text: this.text });
  }
}

const audio = () => Readable.from(Buffer.from('fake-audio'));

describe('TranscriptionService', () => {
  it('returns the provider text, trimmed', async () => {
    const service = new TranscriptionService(new FakeProvider('  the roof leaks  '));
    await expect(service.transcribe(audio())).resolves.toBe('the roof leaks');
  });

  it('passes options through to the provider', async () => {
    const provider = new FakeProvider('content');
    const service = new TranscriptionService(provider);
    await service.transcribe(audio(), { filename: 'audio/u/j.m4a', language: 'en' });
    expect(provider.lastOpts).toEqual({ filename: 'audio/u/j.m4a', language: 'en' });
  });

  it('throws a permanent EmptyTranscriptError on a silent recording', async () => {
    const service = new TranscriptionService(new FakeProvider('   \n  '));
    await expect(service.transcribe(audio())).rejects.toBeInstanceOf(EmptyTranscriptError);
    expect(new EmptyTranscriptError().permanent).toBe(true);
  });
});
