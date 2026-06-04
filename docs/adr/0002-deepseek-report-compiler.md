# 2. Use DeepSeek (OpenAI-compatible) for report compilation

Date: 2026-06-04

Status: Accepted

## Context

The production handoff (§2/§8/§17) specifies **Claude Haiku 4.5** via Anthropic
tool-use for Stage 2 of the pipeline — compiling a raw inspection transcript into
a structured `sections → findings` report. The compiler is the one stage with a
hard correctness invariant: it must **only structure what the transcript says and
invent nothing**, emitting exactly one severity (`info|maintenance|repair|safety`)
per finding and omitting empty sections.

The product owner asked to switch the compilation model from Anthropic to
**DeepSeek**. This ADR records that decision and why the swap is low-risk given
how the compile stage was already designed.

## Decision

Replace the Anthropic-backed report compiler with a **DeepSeek**-backed one.

- DeepSeek exposes an **OpenAI-compatible Chat Completions API** with function
  calling, so we reuse the `openai` SDK (already a dependency for the alternate
  STT provider) pointed at `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`)
  — no new SDK is added, and `@anthropic-ai/sdk` is removed.
- The model is pinned with `tool_choice: { type: 'function', function: { name:
  emit_inspection_report } }` so the structured report arrives as a function
  tool-call whose JSON arguments we parse — never free-form prose. `temperature`
  is `0` for faithful, deterministic extraction.
- Default `REPORT_MODEL` is `deepseek-chat` (DeepSeek-V3, which supports function
  calling). Config: `DEEPSEEK_API_KEY` + `DEEPSEEK_BASE_URL` replace
  `ANTHROPIC_API_KEY`; the boot-time fail-fast rule now requires `DEEPSEEK_API_KEY`
  unless `USE_MOCK_AI=true` (or `NODE_ENV=test`).

The **policy layer is unchanged and provider-agnostic**: `ReportCompilerService`
still validates every model output against the `compiledReportSchema` zod schema,
retries exactly once with a repair hint on malformed output, then fails the job
cleanly with a permanent `MalformedReportError`. The "never fabricate findings"
prompt (`REPORT_SYSTEM_PROMPT`) and the JSON tool schema are shared across
providers. Swapping the provider therefore changes only the transport, not the
correctness guarantees.

## Consequences

- **Positive.** One fewer SDK; the compile contract (schema-validate → retry-once →
  fail) is enforced identically regardless of model, so the new provider inherits
  the same safety net. The `ReportCompilerProvider` seam means a future provider
  swap is again a one-file change plus config.
- **Negative / risks.**
  - DeepSeek's forced-tool adherence is less battle-tested than Claude's. If the
    model ever ignores `tool_choice` and returns prose, the provider throws and the
    service's validate-then-retry path absorbs it; persistent failure fails the job
    cleanly rather than fabricating a report. This is the intended fail-closed
    behavior, but malformed-output retry rates should be monitored in production.
  - DeepSeek is a distinct data processor from Anthropic. Transcripts (which may
    contain property addresses) are sent to DeepSeek's API for compilation — review
    the data-processing terms before launch. No change to the "no secrets on the
    client" or "server is the source of truth" directives.
  - This deviates from the handoff, which remains the source of truth for
    everything else. The handoff's references to Claude/Anthropic for Stage 2 are
    superseded by this ADR.

## Alternatives considered

- **Keep Anthropic Claude Haiku 4.5** (handoff default). Rejected per the product
  owner's request.
- **DeepSeek via its native (non-OpenAI) API.** Rejected: the OpenAI-compatible
  surface lets us reuse the existing SDK and the same function-calling code path,
  minimizing new surface area.
