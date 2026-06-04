import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { appConfig } from '../../config/configuration';
import { DeepgramTranscriptionProvider } from './deepgram.provider';
import { MockTranscriptionProvider } from './mock.provider';
import { OpenAiTranscriptionProvider } from './openai.provider';
import { TRANSCRIPTION_PROVIDER, TranscriptionProvider } from './transcription-provider.interface';
import { TranscriptionService } from './transcription.service';

/**
 * Binds TRANSCRIPTION_PROVIDER to a concrete implementation chosen once at boot.
 * USE_MOCK_AI (and NODE_ENV=test) short-circuit to the deterministic mock so the
 * full pipeline runs without external keys (handoff §8/§15).
 */
@Module({
  providers: [
    {
      provide: TRANSCRIPTION_PROVIDER,
      inject: [appConfig.KEY],
      useFactory: (cfg: ConfigType<typeof appConfig>): TranscriptionProvider => {
        if (cfg.ai.useMock) {
          return new MockTranscriptionProvider();
        }
        if (cfg.ai.transcriptionProvider === 'openai') {
          return new OpenAiTranscriptionProvider(cfg.ai.openaiApiKey, cfg.ai.openaiTranscribeModel);
        }
        return new DeepgramTranscriptionProvider(cfg.ai.deepgramApiKey, cfg.ai.deepgramModel);
      },
    },
    TranscriptionService,
  ],
  exports: [TranscriptionService],
})
export class TranscriptionModule {}
