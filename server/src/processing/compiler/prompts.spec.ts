import {
  buildReportUserPrompt,
  buildRepairHint,
  REPORT_SYSTEM_PROMPT,
} from './prompts';
import { API_SEVERITIES } from '../../jobs/severity';
import { REPORT_TOOL_NAME } from './report.schema';

describe('REPORT_SYSTEM_PROMPT', () => {
  it('encodes the never-fabricate directive', () => {
    expect(REPORT_SYSTEM_PROMPT).toMatch(/Never invent/i);
    expect(REPORT_SYSTEM_PROMPT).toMatch(/grounded in/i);
  });

  it('defines every severity level', () => {
    for (const severity of API_SEVERITIES) {
      expect(REPORT_SYSTEM_PROMPT).toContain(severity);
    }
  });

  it('instructs the model to respond only via the tool', () => {
    expect(REPORT_SYSTEM_PROMPT).toMatch(/calling the provided tool/i);
  });
});

describe('buildReportUserPrompt', () => {
  it('embeds the trimmed label and transcript', () => {
    const prompt = buildReportUserPrompt('  42 Oak Ave  ', '  the roof leaks  ');
    expect(prompt).toContain('42 Oak Ave');
    expect(prompt).toContain('the roof leaks');
    expect(prompt).toContain(REPORT_TOOL_NAME);
  });

  it('falls back to a neutral label when none is given', () => {
    const prompt = buildReportUserPrompt('   ', 'transcript body');
    expect(prompt).toContain('the inspected property');
  });
});

describe('buildRepairHint', () => {
  it('relays the validation issues and re-states the tool contract', () => {
    const hint = buildRepairHint('- sections.0.title: Required');
    expect(hint).toContain('- sections.0.title: Required');
    expect(hint).toMatch(/did not match the required schema/i);
    expect(hint).toContain('info, maintenance, repair, safety');
  });
});

it('pins the forced tool name the system prompt refers to', () => {
  expect(REPORT_TOOL_NAME).toBe('emit_inspection_report');
});
