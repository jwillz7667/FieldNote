import { Module } from '@nestjs/common';
import { JobsRepository } from '../../jobs/jobs.repository';
import { CompilerModule } from '../compiler/compiler.module';
import { PdfModule } from '../pdf/pdf.module';
import { TranscriptionModule } from '../transcription/transcription.module';
import { PipelineService } from './pipeline.service';

/**
 * Wires the three AI stages + persistence into the orchestrator. PrismaModule
 * and MediaModule are @Global. JobsRepository is provided directly (not via
 * JobsModule) so the worker never pulls in the API's JobsService/controller and
 * its queue-producer dependency — the worker is a pure consumer.
 */
@Module({
  imports: [TranscriptionModule, CompilerModule, PdfModule],
  providers: [PipelineService, JobsRepository],
  exports: [PipelineService],
})
export class PipelineModule {}
