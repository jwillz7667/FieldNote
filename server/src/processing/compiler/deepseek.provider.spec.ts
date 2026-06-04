import { REPORT_TOOL_NAME } from './report.schema';

// jest hoists this above imports; the factory may only close over `mock*` names.
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
    constructor(_opts: unknown) {}
  },
}));

// Imported after the mock is registered.
import { DeepSeekReportCompiler } from './deepseek.provider';

function toolCallResponse(args: string) {
  return {
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: REPORT_TOOL_NAME, arguments: args } },
          ],
        },
      },
    ],
  };
}

const provider = new DeepSeekReportCompiler('sk-test', 'deepseek-chat', 'https://api.deepseek.com');
const input = { label: '123 Main St', transcript: 'the roof leaks' };

describe('DeepSeekReportCompiler', () => {
  it('forces the report tool and parses its JSON arguments', async () => {
    mockCreate.mockResolvedValueOnce(toolCallResponse(JSON.stringify({ sections: [] })));

    const result = await provider.compile(input);

    expect(result).toEqual({ sections: [] });
    const params = mockCreate.mock.calls[0][0];
    expect(params.model).toBe('deepseek-chat');
    expect(params.temperature).toBe(0);
    expect(params.tool_choice).toEqual({ type: 'function', function: { name: REPORT_TOOL_NAME } });
    expect(params.messages[0].role).toBe('system');
    expect(params.messages[1].content).toContain('123 Main St');
  });

  it('appends the repair hint to the user message on retry', async () => {
    mockCreate.mockResolvedValueOnce(toolCallResponse(JSON.stringify({ sections: [] })));

    await provider.compile(input, 'PREVIOUS OUTPUT WAS INVALID');

    const params = mockCreate.mock.calls[0][0];
    expect(params.messages[1].content).toContain('PREVIOUS OUTPUT WAS INVALID');
  });

  it('throws when the model returns no tool call', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ finish_reason: 'stop', message: { content: 'sorry, here is prose' } }],
    });

    await expect(provider.compile(input)).rejects.toThrow(/did not return a tool call/i);
  });

  it('throws when the tool arguments are not valid JSON', async () => {
    mockCreate.mockResolvedValueOnce(toolCallResponse('this is not json'));

    await expect(provider.compile(input)).rejects.toThrow(/non-JSON/i);
  });
});
