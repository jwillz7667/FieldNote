import { Inject, Injectable, Logger } from '@nestjs/common';
import { Severity } from '@prisma/client';
import { ZodError } from 'zod';
import { severityFromApi } from '../../jobs/severity';
import { ReportSectionInput } from '../../jobs/report.types';
import {
  CompileInput,
  REPORT_COMPILER_PROVIDER,
  ReportCompilerProvider,
} from './report-compiler-provider.interface';
import { buildRepairHint } from './prompts';
import { compiledReportSchema } from './report.schema';

/** Severity ordering for within-section sorting (most severe first). */
const SEVERITY_RANK: Record<Severity, number> = {
  SAFETY: 0,
  REPAIR: 1,
  MAINTENANCE: 2,
  INFO: 3,
};

/**
 * Owns the compile policy independent of the backing model (handoff §8):
 * validate the model output against the schema, retry exactly once with a
 * repair hint on malformed output, then fail cleanly. Enforces the prime
 * directive structurally — empty sections are dropped and nothing is invented
 * here; the service only normalizes what the provider returned.
 */
@Injectable()
export class ReportCompilerService {
  private readonly logger = new Logger(ReportCompilerService.name);

  constructor(
    @Inject(REPORT_COMPILER_PROVIDER) private readonly provider: ReportCompilerProvider,
  ) {}

  async compile(input: CompileInput): Promise<ReportSectionInput[]> {
    const first = await this.provider.compile(input);
    const firstParse = compiledReportSchema.safeParse(first);
    if (firstParse.success) {
      return this.normalize(firstParse.data.sections);
    }

    const hint = buildRepairHint(formatIssues(firstParse.error));
    this.logger.warn(`Compiler output failed validation; retrying once. ${formatIssues(firstParse.error)}`);
    const second = await this.provider.compile(input, hint);
    const secondParse = compiledReportSchema.safeParse(second);
    if (secondParse.success) {
      return this.normalize(secondParse.data.sections);
    }

    throw new MalformedReportError(formatIssues(secondParse.error));
  }

  /** Map API severities to Prisma enum, sort findings by severity, drop empties. */
  private normalize(
    sections: ReturnType<typeof compiledReportSchema.parse>['sections'],
  ): ReportSectionInput[] {
    return sections
      .map((section) => ({
        title: section.title.trim(),
        findings: section.findings
          .map((f) => ({ text: f.text.trim(), severity: severityFromApi(f.severity) }))
          .filter((f) => f.text.length > 0)
          .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
      }))
      .filter((section) => section.title.length > 0 && section.findings.length > 0);
  }
}

function formatIssues(error: ZodError): string {
  return error.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

/** Permanent failure: the model could not produce schema-valid output twice. */
export class MalformedReportError extends Error {
  readonly permanent = true;
  constructor(issues: string) {
    super(`Report compiler returned malformed output after one retry:\n${issues}`);
    this.name = 'MalformedReportError';
  }
}
