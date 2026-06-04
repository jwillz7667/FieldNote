/**
 * Swappable report-compilation backend (handoff §8). A provider performs ONE
 * attempt and returns the raw, unvalidated tool input; the service owns schema
 * validation and the single retry so that policy lives in one place regardless
 * of which model backs the provider.
 */
export interface CompileInput {
  /** Job label / property address — context only, never a source of findings. */
  label: string;
  transcript: string;
}

export interface ReportCompilerProvider {
  /**
   * @param repairHint when set, the previous attempt failed validation; the
   * provider should pass this back to the model to steer a corrected output.
   * @returns the raw tool input as produced by the model (validated upstream).
   */
  compile(input: CompileInput, repairHint?: string): Promise<unknown>;
}

export const REPORT_COMPILER_PROVIDER = Symbol('REPORT_COMPILER_PROVIDER');
