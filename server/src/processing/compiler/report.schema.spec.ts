import { API_SEVERITIES } from '../../jobs/severity';
import {
  compiledReportSchema,
  REPORT_TOOL_NAME,
  reportToolInputSchema,
} from './report.schema';

describe('compiledReportSchema', () => {
  it('accepts a well-formed report', () => {
    const result = compiledReportSchema.safeParse({
      sections: [
        { title: 'Roof', findings: [{ text: 'Missing shingles', severity: 'repair' }] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty sections array (nothing to report)', () => {
    expect(compiledReportSchema.safeParse({ sections: [] }).success).toBe(true);
  });

  it('rejects an unknown severity', () => {
    const result = compiledReportSchema.safeParse({
      sections: [{ title: 'Roof', findings: [{ text: 'x', severity: 'urgent' }] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a finding with empty text', () => {
    const result = compiledReportSchema.safeParse({
      sections: [{ title: 'Roof', findings: [{ text: '   ', severity: 'info' }] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a section with a missing title', () => {
    const result = compiledReportSchema.safeParse({
      sections: [{ findings: [{ text: 'x', severity: 'info' }] }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects extraneous top-level shapes', () => {
    expect(compiledReportSchema.safeParse({ foo: 'bar' }).success).toBe(false);
    expect(compiledReportSchema.safeParse(null).success).toBe(false);
  });
});

describe('reportToolInputSchema (forced model tool)', () => {
  it('is named to match the system prompt instruction', () => {
    expect(REPORT_TOOL_NAME).toBe('emit_inspection_report');
  });

  it('mirrors the zod severity enum exactly (no drift)', () => {
    const severityEnum =
      reportToolInputSchema.properties.sections.items.properties.findings.items.properties.severity
        .enum;
    expect([...severityEnum]).toEqual([...API_SEVERITIES]);
  });

  it('forbids additional properties at every object level', () => {
    const root = reportToolInputSchema;
    const section = root.properties.sections.items;
    const finding = section.properties.findings.items;
    expect(root.additionalProperties).toBe(false);
    expect(section.additionalProperties).toBe(false);
    expect(finding.additionalProperties).toBe(false);
  });
});
