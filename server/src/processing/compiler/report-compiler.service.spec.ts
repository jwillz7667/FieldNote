import {
  MalformedReportError,
  ReportCompilerService,
} from './report-compiler.service';
import {
  CompileInput,
  ReportCompilerProvider,
} from './report-compiler-provider.interface';

/** Fake provider that returns queued responses and records how it was called. */
class FakeProvider implements ReportCompilerProvider {
  calls: Array<{ input: CompileInput; repairHint?: string }> = [];
  constructor(private readonly responses: unknown[]) {}
  compile(input: CompileInput, repairHint?: string): Promise<unknown> {
    this.calls.push({ input, repairHint });
    return Promise.resolve(this.responses[this.calls.length - 1]);
  }
}

const input: CompileInput = { label: '123 Main St', transcript: 'roof and electrical notes' };

describe('ReportCompilerService', () => {
  it('normalizes valid output: maps severity, sorts most-severe-first, trims, drops empty sections', async () => {
    const provider = new FakeProvider([
      {
        sections: [
          {
            title: '  Roof  ',
            findings: [
              { text: 'Aging shingles', severity: 'maintenance' },
              { text: 'Exposed nail heads', severity: 'safety' },
              { text: 'Cracked flashing', severity: 'repair' },
            ],
          },
          { title: 'Empty Section', findings: [] },
        ],
      },
    ]);
    const service = new ReportCompilerService(provider);

    const result = await service.compile(input);

    expect(provider.calls).toHaveLength(1);
    expect(result).toEqual([
      {
        title: 'Roof',
        findings: [
          { text: 'Exposed nail heads', severity: 'SAFETY' },
          { text: 'Cracked flashing', severity: 'REPAIR' },
          { text: 'Aging shingles', severity: 'MAINTENANCE' },
        ],
      },
    ]);
  });

  it('retries exactly once with a repair hint when the first output is malformed', async () => {
    const provider = new FakeProvider([
      { sections: [{ title: 'Roof', findings: [{ text: 'x', severity: 'URGENT' }] }] },
      { sections: [{ title: 'Roof', findings: [{ text: 'x', severity: 'repair' }] }] },
    ]);
    const service = new ReportCompilerService(provider);

    const result = await service.compile(input);

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].repairHint).toBeUndefined();
    expect(provider.calls[1].repairHint).toEqual(expect.stringContaining('schema'));
    expect(result).toEqual([{ title: 'Roof', findings: [{ text: 'x', severity: 'REPAIR' }] }]);
  });

  it('throws a permanent MalformedReportError when output is malformed twice', async () => {
    const provider = new FakeProvider([{ nope: true }, { still: 'bad' }]);
    const service = new ReportCompilerService(provider);

    await expect(service.compile(input)).rejects.toBeInstanceOf(MalformedReportError);
    expect(provider.calls).toHaveLength(2);
    expect(new MalformedReportError('x').permanent).toBe(true);
  });
});
