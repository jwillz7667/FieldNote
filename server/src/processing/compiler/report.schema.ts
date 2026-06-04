import { z } from 'zod';
import { API_SEVERITIES } from '../../jobs/severity';

/**
 * Canonical shape of a compiled report. This zod schema is the single source of
 * truth: the model tool `parameters` schema (below) mirrors it, and every model
 * output — real or mock — is validated against it before it ever touches the DB
 * (handoff §8 "validate model output, retry once on malformed, then fail").
 */
export const compiledFindingSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  severity: z.enum(API_SEVERITIES),
});

export const compiledSectionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  findings: z.array(compiledFindingSchema).max(200),
});

export const compiledReportSchema = z.object({
  sections: z.array(compiledSectionSchema).max(100),
});

export type CompiledFinding = z.infer<typeof compiledFindingSchema>;
export type CompiledSection = z.infer<typeof compiledSectionSchema>;
export type CompiledReport = z.infer<typeof compiledReportSchema>;

export const REPORT_TOOL_NAME = 'emit_inspection_report';

/**
 * JSON Schema handed to the model as a forced tool (DeepSeek via the
 * OpenAI-compatible `function.parameters`). Kept hand-aligned with the zod
 * schema above (the worker validates the result with zod regardless, so a drift
 * fails loudly in tests rather than silently corrupting data).
 */
export const reportToolInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sections: {
      type: 'array',
      description: 'Inspection sections, in the order they should appear in the report. Omit any section with no findings.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: {
            type: 'string',
            description: 'Short section heading, e.g. "Roof", "Electrical", "Plumbing".',
          },
          findings: {
            type: 'array',
            description: 'Distinct observations stated in the transcript for this section.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: {
                  type: 'string',
                  description: 'One observation, faithfully paraphrased from the transcript. Never invent details.',
                },
                severity: {
                  type: 'string',
                  enum: [...API_SEVERITIES],
                  description:
                    'info = neutral observation; maintenance = upkeep/cleaning; repair = needs fixing; safety = hazard to occupants.',
                },
              },
              required: ['text', 'severity'],
            },
          },
        },
        required: ['title', 'findings'],
      },
    },
  },
  required: ['sections'],
} as const;
