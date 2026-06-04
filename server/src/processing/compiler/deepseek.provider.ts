import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import {
  CompileInput,
  ReportCompilerProvider,
} from './report-compiler-provider.interface';
import { buildReportUserPrompt, REPORT_SYSTEM_PROMPT } from './prompts';
import { REPORT_TOOL_NAME, reportToolInputSchema } from './report.schema';

/**
 * DeepSeek report compiler via forced function-calling (handoff §8, see
 * docs/adr/0002). DeepSeek exposes an OpenAI-compatible Chat Completions API, so
 * we reuse the openai SDK pointed at DeepSeek's base URL. tool_choice pins the
 * model to emit_inspection_report, so the structured payload arrives as a
 * function tool_call whose JSON arguments we parse — never free-form prose.
 * The service still validates the parsed output against the zod schema and
 * retries once, so a stray non-tool or malformed response fails closed.
 */
export class DeepSeekReportCompiler implements ReportCompilerProvider {
  private readonly logger = new Logger(DeepSeekReportCompiler.name);
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    baseURL: string,
    private readonly maxTokens = 4096,
  ) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async compile(input: CompileInput, repairHint?: string): Promise<unknown> {
    const userText = repairHint
      ? `${buildReportUserPrompt(input.label, input.transcript)}\n\n${repairHint}`
      : buildReportUserPrompt(input.label, input.transcript);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      // Deterministic structuring: we want faithful extraction, not creativity.
      temperature: 0,
      messages: [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: REPORT_TOOL_NAME,
            description: 'Emit the structured inspection report compiled from the transcript.',
            parameters: reportToolInputSchema,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: REPORT_TOOL_NAME } },
    });

    const choice = response.choices[0];
    const toolCall = choice?.message.tool_calls?.find(
      (call) => call.function.name === REPORT_TOOL_NAME,
    );
    const raw = toolCall?.function.arguments;
    if (!raw) {
      this.logger.warn(
        `Model returned no ${REPORT_TOOL_NAME} tool call (finish_reason=${choice?.finish_reason})`,
      );
      throw new Error('Report compiler did not return a tool call');
    }

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      // Let the service's validate-then-retry policy handle the recovery.
      this.logger.warn('Tool call arguments were not valid JSON');
      throw new Error('Report compiler returned non-JSON tool arguments');
    }
  }
}
