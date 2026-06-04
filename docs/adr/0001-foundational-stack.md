# 1. Foundational stack and architecture

Date: 2026-06-04

Status: Accepted

## Context

FieldNote turns a home inspector's spoken walkthrough into a branded PDF report.
The whole product is one flow: record while walking → audio uploads → a server
pipeline transcribes, compiles a structured report (sections → findings, each with
a severity), and renders a PDF → the inspector reviews/edits → shares the PDF.

Four prime directives constrain every decision (handoff §1):

1. **"Simple" is a UI/UX rule only.** It constrains the iOS experience, not the
   backend. The server, data layer, storage, and AI engine are production-complete.
2. **The server is the source of truth.** Postgres holds canonical data; the iOS
   app is an offline-first cache that syncs (last-write-wins by `updatedAt`).
3. **AI work is server-side.** The device only records and uploads audio.
4. **No secrets on the client, ever.** Provider keys live on the server; the app
   reaches object storage only through short-lived presigned URLs.

This ADR records the foundational technology choices. Stage-2 model selection is
revised by [ADR 0002](0002-deepseek-report-compiler.md).

## Decision

A two-service monorepo: `ios/` (SwiftUI client) and `server/` (one NestJS codebase
deployed twice — as the HTTP API and as the pipeline worker).

| Concern | Choice | Why |
| --- | --- | --- |
| iOS UI + persistence | **SwiftUI + SwiftData**, Swift 6 strict concurrency, iOS 26 | Native Liquid Glass; offline-first local cache; structured concurrency isolates the recorder/uploader as actors. |
| API + worker | **NestJS 11** (one codebase, two entrypoints) | DI + module boundaries; `dist/main.js` (API) and `dist/worker.js` (worker) share domain code. |
| Database / ORM | **Postgres 16 + Prisma 6** | Relational integrity, transactions, first-class migrations, per-user scoping at the query layer. |
| Queue | **BullMQ 5 + Redis 7** | Reliable async pipeline with retries, backoff, and a dead-letter queue. |
| Object storage | **Cloudflare R2** (S3 API via `@aws-sdk/client-s3`) | Cheap egress; presigned URLs are the only client path to media. |
| Transcription | **Deepgram Nova-3** (OpenAI `gpt-4o-mini-transcribe` as alt) | Provider chosen at boot behind a `TranscriptionProvider` seam. |
| Report compilation | **DeepSeek** (OpenAI-compatible forced function-calling) | See [ADR 0002](0002-deepseek-report-compiler.md). |
| PDF | **Puppeteer** (HTML → PDF, headless Chromium) | Highest design fidelity for a branded report. |
| Auth | **Sign in with Apple → app JWT** (access + rotating refresh) | No passwords; Apple identity verified server-side against JWKS. |
| Hosting | **Railway**: `api`, `worker`, `postgres`, `redis` | One platform, private networking, simple deploys. |

**Pipeline.** The worker is idempotent and resumable, writing one `ProcessingEvent`
per stage: download audio from R2 → transcribe → compile structured report → render
PDF → upload PDF → `status = READY`. `JobStatus` walks `CREATED → UPLOADING →
QUEUED → TRANSCRIBING → COMPILING → RENDERING → READY/FAILED`. Re-running a `READY`
job is a no-op.

**Cross-cutting invariants** enforced in code, not convention:

- **Per-user scoping** in the service/repository layer — never trust a
  client-supplied `userId`; every job query is scoped by the JWT subject.
- **Idempotency** — `Idempotency-Key` on job create; a stable job id on `/process`
  so retries never duplicate pipeline work.
- **Fail-fast config** — the process refuses to boot if any required env var is
  missing/malformed (zod schema in `src/config/env.ts`).
- **Never fabricate findings** — the compiler only structures what the transcript
  says, validated against a schema with retry-once-then-fail.

## Consequences

- **Positive.** One Nest codebase for API + worker keeps domain types and DB access
  shared and consistent. Provider seams (transcription, compilation) make model swaps
  a one-file-plus-config change. Offline-first SwiftData means the app is usable with
  no connectivity and reconciles deterministically on reconnect.
- **Negative / costs.** Puppeteer pulls a ~real Chromium into the worker image
  (memory-hungry; needs `--no-sandbox` in-container and a RAM bump). Last-write-wins
  is simple but lossy under true concurrent edits — acceptable for a single-user,
  single-device launch; real-time collaboration is explicitly v2. Two deploy targets
  from one image add a small amount of release choreography.
- **Build order.** Phases P0–P12 (handoff §11) ship in order, each ending deployable
  behind an acceptance gate. v2 scope (real-time collab, team accounts, billing, a
  second vertical, photos/live transcription) is out and must be flagged, not
  silently expanded.

## Alternatives considered

- **CloudKit / iCloud sync** instead of a custom backend. Rejected: the AI pipeline,
  branded PDF rendering, and provider-key custody must live server-side; CloudKit
  can't host them and would split the source of truth.
- **`@react-pdf/renderer`** (pure Node) instead of Puppeteer. Rejected: Puppeteer
  wins on design fidelity for a branded report; the container cost is acceptable.
- **Serverless functions** for the pipeline. Rejected: long-running transcription +
  Chromium rendering fit a persistent worker with a real queue far better than
  cold-start-bounded functions.
