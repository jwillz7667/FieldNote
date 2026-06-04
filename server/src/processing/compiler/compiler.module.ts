import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { appConfig } from '../../config/configuration';
import { DeepSeekReportCompiler } from './deepseek.provider';
import { MockReportCompiler } from './mock.provider';
import {
  REPORT_COMPILER_PROVIDER,
  ReportCompilerProvider,
} from './report-compiler-provider.interface';
import { ReportCompilerService } from './report-compiler.service';

/**
 * Binds REPORT_COMPILER_PROVIDER once at boot. USE_MOCK_AI / NODE_ENV=test use
 * the deterministic mock so the pipeline runs without a DeepSeek key.
 */
@Module({
  providers: [
    {
      provide: REPORT_COMPILER_PROVIDER,
      inject: [appConfig.KEY],
      useFactory: (cfg: ConfigType<typeof appConfig>): ReportCompilerProvider =>
        cfg.ai.useMock
          ? new MockReportCompiler()
          : new DeepSeekReportCompiler(
              cfg.ai.deepseekApiKey,
              cfg.ai.reportModel,
              cfg.ai.deepseekBaseUrl,
            ),
    },
    ReportCompilerService,
  ],
  exports: [ReportCompilerService],
})
export class CompilerModule {}
