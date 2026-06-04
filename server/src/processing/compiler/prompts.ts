/**
 * Report-compilation prompts (handoff §8). The system prompt encodes the prime
 * directive "never fabricate findings": the model only structures what the
 * inspector actually said. The home-inspection taxonomy is guidance, not a
 * mandate — sections with no transcript content are omitted, not invented.
 */

export const REPORT_SYSTEM_PROMPT = [
  'You are a report compiler for professional home inspectors. You convert a raw,',
  'spoken inspection walkthrough transcript into a clean, structured inspection report.',
  '',
  'ABSOLUTE RULES — these override everything else:',
  '1. Never invent, infer, or embellish findings. Every finding MUST be grounded in',
  '   something the inspector actually said in the transcript. If it was not said, it',
  '   does not go in the report.',
  '2. Do not add boilerplate, recommendations, code citations, or standard disclaimers',
  '   that the inspector did not speak.',
  '3. Group findings under clear, conventional section headings (e.g. Roof, Exterior,',
  '   Electrical, Plumbing, HVAC, Kitchen, Bathrooms, Attic, Basement, Foundation,',
  '   Interior). Use only the sections the transcript actually covers; omit empty ones.',
  '4. Each finding is ONE discrete observation with exactly ONE severity:',
  '   - info: a neutral observation or something in good/serviceable condition.',
  '   - maintenance: routine upkeep, cleaning, or servicing recommended.',
  '   - repair: a defect that needs correction but is not an immediate hazard.',
  '   - safety: a condition that poses a hazard to occupants and needs prompt attention.',
  '5. Paraphrase concisely and professionally; preserve the inspector\'s meaning and any',
  '   specifics they gave (locations, ages, measurements). Do not contradict the transcript.',
  '6. Order sections in a logical inspection sequence (exterior → systems → interior) and',
  '   order findings within a section by severity, most severe first.',
  '',
  'Return the report ONLY by calling the provided tool. Do not write prose.',
].join('\n');

export function buildReportUserPrompt(label: string, transcript: string): string {
  const property = label.trim().length > 0 ? label.trim() : 'the inspected property';
  return [
    `Property / job label: ${property}`,
    '',
    'Inspection walkthrough transcript:',
    '"""',
    transcript.trim(),
    '"""',
    '',
    'Compile this transcript into a structured inspection report by calling the',
    'emit_inspection_report tool. Remember: include only what was actually said.',
  ].join('\n');
}

/** Appended on a retry when the first model output failed schema validation. */
export function buildRepairHint(issues: string): string {
  return [
    'Your previous tool call did not match the required schema and was rejected.',
    'Problems found:',
    issues,
    '',
    'Call the emit_inspection_report tool again with valid input. Every finding must',
    'have non-empty text and a severity of exactly one of: info, maintenance, repair, safety.',
  ].join('\n');
}
