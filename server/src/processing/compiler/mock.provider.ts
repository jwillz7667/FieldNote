import {
  CompileInput,
  ReportCompilerProvider,
} from './report-compiler-provider.interface';
import { CompiledReport } from './report.schema';

/**
 * Deterministic report compiler for local dev / tests (USE_MOCK_AI=true). Returns
 * a structured report that corresponds to the mock transcription output, so the
 * full transcribe → compile → render pipeline produces a coherent PDF without a
 * DeepSeek key. Returns the same shape the real provider would, validated by the
 * service against the zod schema exactly like a live model response.
 */
export class MockReportCompiler implements ReportCompilerProvider {
  async compile(_input: CompileInput): Promise<unknown> {
    const report: CompiledReport = {
      sections: [
        {
          title: 'Roof',
          findings: [
            {
              text: 'Two shingles are lifted near the ridge; recommend repair before next winter.',
              severity: 'repair',
            },
            {
              text: 'Asphalt shingle roof is approximately 15 years old with granule loss on the south-facing slope.',
              severity: 'maintenance',
            },
          ],
        },
        {
          title: 'Gutters & Drainage',
          findings: [
            {
              text: 'Downspout at the northeast corner is disconnected, draining water against the foundation. Reattach the downspout.',
              severity: 'repair',
            },
            {
              text: 'Gutters are full of debris and should be cleaned.',
              severity: 'maintenance',
            },
          ],
        },
        {
          title: 'Exterior',
          findings: [
            {
              text: 'Vinyl siding is in good condition overall, with minor fading on the west wall. No structural concerns.',
              severity: 'info',
            },
          ],
        },
        {
          title: 'Electrical',
          findings: [
            {
              text: 'Double-tapped breaker on circuit twelve. Should be corrected by a licensed electrician.',
              severity: 'safety',
            },
            {
              text: '200 amp panel in the garage appears modern.',
              severity: 'info',
            },
          ],
        },
        {
          title: 'Plumbing',
          findings: [
            {
              text: 'Water heater relief valve has no TPR discharge pipe installed. A proper discharge line is required.',
              severity: 'safety',
            },
            {
              text: 'Active leak at the P-trap under the kitchen sink should be repaired.',
              severity: 'repair',
            },
            {
              text: 'Forty gallon gas water heater manufactured in 2016.',
              severity: 'info',
            },
          ],
        },
        {
          title: 'Kitchen',
          findings: [
            {
              text: 'GFCI outlets near the sink test and trip correctly; dishwasher runs without issue.',
              severity: 'info',
            },
          ],
        },
        {
          title: 'Bathrooms',
          findings: [
            {
              text: 'Upstairs bathroom exhaust fan vents into the attic instead of outside; reroute to an exterior vent to prevent moisture problems.',
              severity: 'repair',
            },
          ],
        },
        {
          title: 'Attic',
          findings: [
            {
              text: 'Daylight visible at the plumbing vent roof penetration; minor air sealing recommended.',
              severity: 'maintenance',
            },
            {
              text: 'Blown-in fiberglass insulation is adequate with no signs of pest activity.',
              severity: 'info',
            },
          ],
        },
        {
          title: 'Basement & HVAC',
          findings: [
            {
              text: 'Basement is dry with no efflorescence; sump pump tested functional.',
              severity: 'info',
            },
            {
              text: 'High-efficiency furnace was serviced this year per the service tag.',
              severity: 'info',
            },
          ],
        },
      ],
    };
    return report;
  }
}
