import { Severity } from '@prisma/client';

/** Normalized report tree persisted by both the worker (compiler) and PATCH edits. */
export interface ReportFindingInput {
  text: string;
  severity: Severity;
}

export interface ReportSectionInput {
  title: string;
  findings: ReportFindingInput[];
}
