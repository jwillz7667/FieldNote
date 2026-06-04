# FieldNote — Production Build Handoff (Claude Code)

> **Supersedes the earlier iOS-only handoff.** This is a full-stack, production-grade
> system, not an MVP. Build every layer to the standard of a professional team:
> tested, observed, secured, persistent. The **only** thing that is "simple" is the
> end-user's experience — see §4. The backend, data layer, object storage, and AI
> engine are fully engineered, nothing deferred.
>
> Six iOS starter files exist; §4.4 says exactly which to keep, revise, or delete.
> Work the phases in §11 in order. Each phase ends deployable and verifiable.

---

## 0. Prime directives

1. **"Simple" is a UI/UX rule only.** It governs the iOS experience (few taps, large targets, Liquid Glass restraint). It does **not** mean a thin or deferred backend. Persistence, auth, the AI pipeline, and storage are all production-complete.
2. **Server is the source of truth.** Postgres holds canonical data. The iOS app is an offline-first cache that syncs.
3. **The AI work happens server-side.** The device records and uploads audio; a backend pipeline transcribes it, compiles a structured report, and renders the PDF. This keeps the app simple and the engine controllable.
4. **No secrets on the client, ever.** All provider keys live on the server. The app touches object storage only through short-lived presigned URLs.
5. **Liquid Glass discipline is non-negotiable** (functional layer only). See §4.3.

---

## 1. Product

FieldNote removes the worst part of field work — the hour of typing notes after a job. A home inspector opens the app, enters the property address, taps record, and talks while walking the house. On stop, the recording uploads; a server pipeline transcribes it on-device-quality, an LLM compiles a structured inspection report (findings grouped by section, each with a severity), and a branded PDF is generated. The inspector reviews/edits and shares the PDF.

**Launch vertical:** home inspection. The report is **template-driven** so it generalizes later, but v1 ships home inspection only.

**Core user flow (the whole app):** `+` → enter address → tap record → talk → stop → (auto upload + server processing) → review/edit report → share PDF.

**User reality:** on-site, often poor connectivity, holding the phone. The app must never lose a recording, must work offline up to upload, and must upload reliably in the background when a connection returns.

---

## 2. System architecture

```
┌─────────────────────────────┐         ┌──────────────────────────────────────────────┐
│        iOS app (SwiftUI)     │         │                Railway                        │
│  • record audio (local)      │  HTTPS  │  ┌────────────┐   enqueue   ┌──────────────┐  │
│  • SwiftData cache (offline) │ ──────► │  │  API (Nest)│ ──────────► │ Redis (BullMQ)│  │
│  • presigned PUT to R2       │         │  └─────┬──────┘             └──────┬───────┘  │
│  • poll job status           │ ◄────── │        │ Prisma                    │ jobs     │
│  • PDF via presigned GET     │  status │  ┌─────▼──────┐             ┌──────▼───────┐  │
└──────────────┬──────────────┘         │  │ Postgres   │             │ Worker (Nest)│  │
               │ PUT/GET (presigned)    │  │ (truth)    │             │  AI ENGINE   │  │
               ▼                        │  └────────────┘             └──────┬───────┘  │
        ┌──────────────┐                └────────────────────────────────────┼─────────┘
        │ Cloudflare R2│ ◄───── audio + pdf objects ─────────────────────────┘
        └──────────────┘
```

**End-to-end data flow:**
1. App creates a draft `Job` (locally + on server). Server returns a presigned **PUT** URL.
2. App records audio; uploads the file directly to R2 via the presigned URL (background-safe).
3. App calls `POST /jobs/:id/process`; API enqueues a BullMQ job.
4. **Worker (the AI engine)**: download audio from R2 → **transcribe** (Deepgram) → persist transcript → **compile report** (Claude, structured output) → persist sections/findings → **render PDF** (HTML→Chromium) → upload PDF to R2 → set status `ready`. Every stage writes a `processing_event`.
5. App polls `GET /jobs/:id`, sees `ready`, renders the report, fetches the PDF via presigned **GET**.
6. App edits sync back via `PATCH /jobs/:id` (server-authoritative, last-write-wins).

**Locked stack decisions** (flag for veto in §17, otherwise proceed):

| Concern | Choice | Why |
|---|---|---|
| API framework | **NestJS** (TypeScript) | Structured, testable, first-class DI/modules/guards/pipes. |
| DB | **Postgres** (Railway managed) | Relational data, constraints, transactions. |
| ORM/migrations | **Prisma** | Type-safe client, first-class migrations. |
| Queue | **BullMQ + Redis** (Railway) | Reliable async pipeline, retries, backoff, DLQ. |
| Object storage | **Cloudflare R2** (S3-compatible) | Audio + PDFs; presigned URLs; cheap egress. |
| Transcription | **Deepgram Nova-3** (primary) / OpenAI `gpt-4o-mini-transcribe` (alt) | Best on noisy field audio; cheap batch; swappable. |
| Report LLM | **Claude Haiku 4.5** (default) / Sonnet 4.6 (quality) | Fast/cheap structuring; tool-use for strict JSON. |
| PDF | **Puppeteer + HTML/CSS template** (primary) / `@react-pdf/renderer` (alt) | Branded, high-fidelity, design-iterable. |
| Auth | **Sign in with Apple → app JWT** | Native iOS path, no passwords. |
| Client cache | **SwiftData** offline-first + server-authoritative sync | Never lose a recording; works offline. |
| Hosting | **Railway**: `api`, `worker`, `postgres`, `redis` services | One platform, private networking, simple deploys. |

---

## 3. Scope

**In scope (v1 — all of it ships):**
- iOS app: record, offline persistence, background audio upload, status polling, report review/edit, PDF view/share, Sign in with Apple.
- NestJS API on Railway: auth, jobs CRUD, media (presigned URLs), processing trigger, OpenAPI docs, validation, rate limiting, logging, health/readiness.
- Postgres schema with migrations, constraints, indexes, per-user scoping.
- R2 integration: private buckets, presigned PUT/GET, key scheme, lifecycle.
- BullMQ worker with the 3-stage AI engine, retries, DLQ, processing-event audit.
- Tests (backend unit/integration/e2e, iOS unit), CI, env validation, monitoring hooks.

**Out of scope (v2 — do not build):**
- Real-time, conflict-free multi-device collaborative editing (v1 sync is offline-first + last-write-wins).
- Team/org accounts, roles, sharing between users.
- Billing/subscriptions/StoreKit.
- A second vertical or in-app template editor (architect for it; don't ship it).
- Photos/annotations in reports; live word-by-word transcription during recording.

If it isn't named in "in scope," it's out. Flag, don't expand silently.

---

## 4. iOS client (the experience stays simple)

### 4.1 Principles
One primary action per screen, large tap targets, one-handed reach, and a flow that never blocks the user on the network. Recording must be instant and never lost. After stop, upload + processing happen in the background with a clear, calm status — the user is not made to wait on a spinner they can't escape.

### 4.2 Revised data + networking layer
- **SwiftData** is the local store (replaces the old JSON `JobStore`). Models mirror the server domain (`Job`, `ReportSection`, `Finding`, plus a local `syncState` and `pendingUpload` flag). The app is fully usable offline; the server reconciles.
- **APIClient** (`URLSession`, async/await): typed calls, JWT in the `Authorization` header, automatic refresh on `401`, exponential backoff on `5xx`/network errors. Tokens stored in the **Keychain**.
- **AudioUploader**: uploads to the presigned R2 URL using a **background `URLSession`** so uploads survive app backgrounding; reports progress; retries.
- **JobSyncService**: on launch/foreground, pulls the user's jobs; after a recording, creates the job, uploads audio, triggers processing, then polls `GET /jobs/:id` (with backoff) until `ready` or `failed`.

### 4.3 Liquid Glass design system (UNCHANGED — keep exactly)
The one law: **Liquid Glass belongs to the functional layer that floats above content** — controls, nav, toolbars, floating buttons, sheets. It must **never** be applied to the content layer (lists, report text, cards, backgrounds). Glass cannot sample glass; stacked/content glass turns muddy and reads as amateur.

- ✅ Glass: the record button (hero), the floating `+`, the **Export/Share** control, and system chrome (nav/toolbar/sheets adopt glass automatically on the iOS 26 SDK — don't fight it).
- ❌ Solid: job rows, the status/transcript card, report section cards, finding rows, screen backgrounds.

Exact APIs (iOS 26): `.glassEffect(_:in:isEnabled:)` applied **last**; `Glass` = `.regular/.clear/.identity` with `.tint(_:)` and `.interactive()`; `GlassEffectContainer(spacing:)` to group; `.glassEffectID(_:in:)` (+ `@Namespace`) for the native morph; `.buttonStyle(.glass)` / `.buttonStyle(.glassProminent)` with `.buttonBorderShape(.circle/.capsule)`; `ToolbarSpacer(.fixed/.flexible)`; `Button(role: .close)` for sheet X; `.contentTransition(.symbolEffect(.replace))` for icon swaps (SF Symbols 7).

The **record button morphs** mic↔stop inside a `GlassEffectContainer` with `.glassEffectID`, `.buttonStyle(.glassProminent)`, tint red while recording, subtle scale/pulse, haptics on start/stop. (Pitfall: if `.glassProminent` errors on contextual type, use `.buttonStyle(.glass)`; the label needs a concrete frame.)

**Accessibility (hard requirement):** must be fully usable with **Reduce Transparency** on; full **Dynamic Type**; `accessibilityLabel`s on icon-only controls. **Test on a physical device** — the simulator under-renders glass; don't sign off the look from it.

### 4.4 Starter-file disposition
| File | Action |
|---|---|
| `FieldNoteApp.swift` | **Revise:** add an auth gate (sign-in screen when no valid session) and a SwiftData `modelContainer`. Keep routing. |
| `Models.swift` | **Revise:** keep domain types (`Job/ReportSection/Finding/Severity/JobStatus`); **delete** the JSON `JobStore`; replace with SwiftData models + a repository. Prefer generating shared DTOs from the OpenAPI spec (§16). |
| `Services.swift` | **Rewrite:** keep `AudioRecorder`; **delete** `TranscriptionService`/`StubTranscriber` and `ReportFormatter` (now server-side); add `APIClient`, `AudioUploader`, `JobSyncService`, Keychain token store. |
| `RecordingView.swift` | **Keep the UI + glass record button verbatim**; change the flow: stop → upload (progress) → server processing (calm status) → auto-navigate to report on `ready`. Remove the client-side "Generate Report" call. |
| `JobsListView.swift` | **Keep**; rows reflect synced status (Uploading / Processing / Ready / Failed). |
| `ReportReviewView.swift` | **Keep editing UI**; **delete** client `UIGraphicsPDFRenderer`; fetch the PDF via presigned GET and show via PDFKit/QuickLook + share; edits `PATCH` to server. |

---

## 5. Backend — NestJS on Railway

**Module layout** (`server/src/`): `app`, `config`, `auth`, `users`, `jobs`, `media`, `processing` (the AI engine), `pdf`, `queue`, `health`, plus `common` (guards, interceptors, filters, DTOs).

**Cross-cutting (all required):**
- **Config:** `@nestjs/config` with **schema validation at boot** (zod/Joi) — the process refuses to start if any required env var is missing or malformed.
- **Validation:** global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) + `class-validator` DTOs on every endpoint.
- **Errors:** a global exception filter returning consistent problem JSON; never leak stack traces in prod.
- **Logging:** `nestjs-pino` structured logs with request IDs; per-stage logs in the worker.
- **Security:** `helmet`, locked CORS, `@nestjs/throttler` rate limiting (tight on `/auth`), HTTPS (Railway-terminated).
- **Docs:** `@nestjs/swagger` → OpenAPI at `/docs`; export `openapi.json` for the iOS client (§16).
- **Health:** `@nestjs/terminus` `GET /health` (liveness) and `GET /ready` (DB + Redis checks).

**REST surface (all under JWT except auth + health):**
```
POST   /auth/apple            # exchange Apple identity token → { access, refresh }
POST   /auth/refresh          # rotate tokens
GET    /jobs                  # paginated, current user only
POST   /jobs                  # create draft; body {label}; Idempotency-Key header
                              # → returns { job, audioUploadUrl } (presigned PUT, short TTL)
GET    /jobs/:id              # job + status + sections/findings + (if ready) pdfUrl
PATCH  /jobs/:id              # update label and/or edited sections (LWW by updatedAt)
POST   /jobs/:id/process      # mark audio uploaded → enqueue processing (idempotent)
GET    /jobs/:id/pdf          # presigned GET URL (or 302 redirect)
DELETE /jobs/:id              # soft-delete row + delete R2 objects
GET    /health  GET /ready
```
Every job query is scoped by `userId` from the JWT. A user can never read or mutate another user's job (enforce in the service, not just the controller).

**Deployment:** one Nest codebase, **two Railway services** sharing Postgres + Redis over private networking — `api` (start: `start:api`) and `worker` (start: `start:worker`). The `worker` service uses the Puppeteer Dockerfile (§15).

---

## 6. Data layer — Postgres (Prisma)

Source of truth. Use migrations for every change (`prisma migrate`); never edit the DB by hand.

**Schema (essentials):**
- `User { id uuid pk, appleSub text unique, email text?, createdAt, updatedAt }`
- `Job { id uuid pk, userId fk→User cascade, label text, status JobStatus, transcript text?, audioKey text?, pdfKey text?, errorMessage text?, createdAt, updatedAt, deletedAt? }` — indexes on `(userId, createdAt desc)` and `status`.
- `ReportSection { id uuid pk, jobId fk→Job cascade, title text, sortOrder int, createdAt, updatedAt }`
- `Finding { id uuid pk, sectionId fk→ReportSection cascade, text text, severity Severity, sortOrder int, createdAt, updatedAt }`
- `ProcessingEvent { id uuid pk, jobId fk→Job cascade, stage text, status text, message text?, createdAt }` — the audit trail for the pipeline.
- Enums: `JobStatus { CREATED, UPLOADING, QUEUED, TRANSCRIBING, COMPILING, RENDERING, READY, FAILED }`, `Severity { INFO, MAINTENANCE, REPAIR, SAFETY }`.

**Rules:** `ON DELETE CASCADE` from Job → sections → findings; soft-delete jobs (`deletedAt`) and exclude in queries; timestamps on everything; wrap multi-row writes (report compilation) in a transaction. Use a Prisma connection **pool** sized to worker concurrency (mind Postgres `max_connections`; set `connection_limit` in the URL).

---

## 7. Object storage — Cloudflare R2

Holds raw audio and generated PDFs. **Private buckets**, no public access.

- **SDK:** `@aws-sdk/client-s3` (R2 is S3-compatible). Config: `endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `region = "auto"`, S3v4 signing, credentials from env.
- **Key scheme:** `audio/{userId}/{jobId}.m4a`, `pdf/{userId}/{jobId}.pdf`.
- **Upload:** server issues a **presigned PUT** (`@aws-sdk/s3-request-presigner`) with the content-type pinned and a short TTL (e.g., 1 hour to survive a slow field upload); the app PUTs the file directly — large audio never transits the API.
- **Download:** **presigned GET** for the PDF, short TTL, returned by `GET /jobs/:id/pdf`.
- **CORS:** set a bucket CORS policy permitting `PUT` with the pinned content-type (matters if you ever upload from web; native is fine).
- **Lifecycle/retention:** define an audio retention policy (e.g., delete raw audio N days after `READY`, keep PDFs); deleting a job deletes its objects. R2 encrypts at rest; rely on TLS in transit.

---

## 8. The AI engine (server-side, the core)

Lives in the `worker` service, orchestrated by a BullMQ processor. The processor is **idempotent** (re-running a `READY` job is a no-op), **retriable** (BullMQ attempts with exponential backoff), has **per-stage timeouts**, and sends permanent failures to a **dead-letter queue**. Each stage writes a `ProcessingEvent` and updates `Job.status`. On any failure, set `status = FAILED` with a user-safe `errorMessage` the app surfaces.

### Stage 1 — Transcription
- Provider behind a `TranscriptionProvider` interface: `transcribe(audioStream, opts) -> { text }`.
- **Primary: Deepgram Nova-3** (batch). Enable smart formatting/punctuation, set language, keep diarization off for v1. Best accuracy on noisy/on-site audio; cheap per minute.
- **Alternative: OpenAI `gpt-4o-mini-transcribe`** via `/audio/transcriptions` (batch). Use if staying OpenAI-native.
- Stream the object from R2 into the provider rather than buffering the whole file; enforce a max audio duration; persist the transcript to `Job.transcript`.

### Stage 2 — Report compilation
- `ReportCompiler` using the **Anthropic API**. Default model `claude-haiku-4-5` (fast/cheap); `claude-sonnet-4-6` as a quality tier.
- Use **tool use / structured output**: define a tool whose `input_schema` matches the report contract so the model returns strict JSON (sections → findings → severity). This avoids brittle text parsing.
- Validate the output against the schema; **retry once** on malformed output; if it still fails, fail the job cleanly. **Never fabricate findings** not present in the transcript — bake that into the system prompt.
- The system prompt (carry over the proven one): organize spoken notes into the template's sections, one professional sentence per finding, exactly one severity of `info|maintenance|repair|safety`, omit empty sections, invent nothing.
- Persist sections/findings in a single transaction (with `sortOrder` preserving section/finding order).

### Stage 3 — PDF
- `PdfRenderer`: render a branded **HTML/CSS template** (property/client header, date, sections, color-coded severity badges, footer/disclaimer) with **Puppeteer/headless Chromium** to Letter/A4 using print CSS. Deterministic and paginated.
- Upload the PDF to R2 (`pdf/{userId}/{jobId}.pdf`); store `pdfKey`; set `status = READY`.
- Alternative if you want to avoid Chromium in the container: `@react-pdf/renderer` (pure Node). (Puppeteer wins on design fidelity; see the Dockerfile in §15.)

**Observability:** `bull-board` for queue visibility in dev; the `ProcessingEvent` table as the per-job audit; structured logs with the `jobId` on every line; optional Sentry.

**Cost/abuse controls:** per-user rate limits and a max audio length; cap worker concurrency to your Postgres/Chromium memory budget; alert on DLQ growth.

---

## 9. Auth & security

- **Sign in with Apple → app JWT.** App sends Apple's identity token to `POST /auth/apple`. Server **verifies the token signature against Apple's rotating JWKS** (`https://appleid.apple.com/auth/keys`, cache keys), validates `iss/aud/exp/nonce`, extracts `sub`, upserts the `User`, and issues a short-lived **access** JWT + a **refresh** token (with rotation). Handle Apple private-relay emails.
- Apple requires a **signed client secret** (ES256, ≤6 months) built from your Team ID, Key ID, and `.p8` key — generate it server-side; plan for rotation.
- **Per-user scoping everywhere**; guards on every protected route; never trust a `userId` from the client.
- **Secrets** only in Railway env vars; R2 and provider keys are server-only; presigned URLs are the sole client path to storage and are short-lived and scoped.
- Validate all input; rate-limit; enforce HTTPS; `helmet`. Treat audio as sensitive (voice) — honor deletion (rows + R2 objects), define retention, encrypt at rest (R2 default) + TLS in transit.

---

## 10. Sync & offline (pragmatic, professional)

- **Server is authoritative.** The app creates a job locally and queues the audio upload; uploads complete when connectivity allows (background `URLSession`). The report is produced server-side and flows to the app on poll.
- **Edits:** `PATCH /jobs/:id` with the edited sections; conflict policy is **last-write-wins by `updatedAt`**. Full conflict-free multi-device editing is explicitly v2.
- **Idempotency:** send an `Idempotency-Key` on create and a stable job id on `process` so retries never duplicate work.
- The app surfaces clear states: Draft → Uploading → Processing → Ready / Failed (with a retry on Failed).

---

## 11. Build phases (full-stack; ordered; each verifiable)

Build incrementally; pause at each acceptance gate.

- **P0 — Repo & tooling.** Monorepo (`/server`, `/ios`), ESLint/Prettier, tsconfig strict, commit hooks, CI (lint + test + build). *AC:* CI green on an empty skeleton.
- **P1 — API skeleton on Railway.** Nest + config validation + health/ready + Swagger + Postgres connected + Prisma + first migration; deployed. *AC:* `/health` and `/docs` reachable on the Railway URL; DB migrated.
- **P2 — Auth.** Sign in with Apple → JWT, refresh rotation, guards, user upsert. *AC:* a real device sign-in returns tokens; protected route rejects without a valid JWT.
- **P3 — Jobs domain.** Schema (jobs/sections/findings/events), CRUD, per-user scoping, validation, OpenAPI. *AC:* CRUD via Swagger scoped to the authed user; cross-user access denied.
- **P4 — R2 media.** Presigned PUT/GET, key scheme, bucket + CORS, soft-delete removes objects. *AC:* upload an audio file via the presigned URL from a script and read it back via presigned GET.
- **P5 — Queue & worker.** BullMQ + Redis service, job lifecycle states, `ProcessingEvent` audit, retries/backoff/DLQ, bull-board. *AC:* `POST /process` enqueues; worker transitions states and records events; a forced failure lands in the DLQ.
- **P6 — AI Stage 1 (transcription).** Deepgram integrated (OpenAI alt behind the interface); transcript persisted. *AC:* a real recording yields an accurate transcript stored on the job.
- **P7 — AI Stage 2 (compilation).** Claude with tool-use structured output → sections/findings persisted transactionally; malformed-output retry. *AC:* transcript produces a sensible structured report; bad model output fails cleanly, never crashes.
- **P8 — AI Stage 3 (PDF).** Puppeteer template → R2 → presigned GET; full pipeline green. *AC:* end-to-end on the server: audio in → branded PDF out, downloadable.
- **P9 — iOS core.** Auth gate, SwiftData, record, background upload, status polling, report render, PDF view/share. *AC:* on a device, record → upload → processing → report + PDF, including offline record then upload-on-reconnect.
- **P10 — iOS editing + sync.** Edit findings/severities; `PATCH` back; LWW. *AC:* edits persist server-side and survive relaunch/reinstall (pulled from server).
- **P11 — Liquid Glass + UX polish + a11y.** Apply §4.3 fully; haptics, symbol transitions, Dynamic Type; verify Reduce Transparency; device test. *AC:* glass only in the functional layer; fully usable with Reduce Transparency; one-handed reachable.
- **P12 — Hardening.** Rate limits, retries/DLQ tuning, structured logging + monitoring, cost caps (max audio length, concurrency), security review, basic load sanity. *AC:* the checklist in §12 passes.

---

## 12. Definition of Done

- Full five-tap flow works on a physical iOS 26 device with real transcription, real LLM compilation, and a real branded PDF.
- API + worker deployed on Railway; Postgres migrated; Redis healthy; R2 wired; `/ready` checks DB + Redis.
- No secrets in the iOS binary; storage reached only via short-lived presigned URLs; all data per-user scoped.
- Pipeline is idempotent and retriable; failures surface to the app with a retry; permanent failures hit the DLQ.
- Data persists across relaunch **and reinstall** (server-authoritative); offline record + background upload works; deletion removes rows and R2 objects.
- Liquid Glass only in the functional layer; passes Reduce Transparency.
- Tests pass (§14); env validation fails fast on misconfig; structured logs + queue visibility in place.

---

## 13. Gotchas & pitfalls (the stuff that wastes hours)

- **Railway:** `api` and `worker` are separate services sharing Postgres/Redis via **private networking** (use the internal URLs); set distinct start commands; persistent containers (no serverless cold-start, but free tier may sleep — note for the human).
- **Prisma + Postgres:** size the pool to worker concurrency; watch `max_connections`; set `connection_limit` in `DATABASE_URL`.
- **R2 presigned PUT:** the client **must** send the exact `Content-Type` you pinned in the signature, or the upload 403s; keep a generous TTL for field uploads.
- **Puppeteer on Railway:** Chromium needs system libs → use a **Dockerfile** (install deps or `npx puppeteer browsers install chrome`), launch with `--no-sandbox` (container), and **bump the worker's RAM** (Chromium is memory-hungry).
- **BullMQ:** workers need Redis with `maxRetriesPerRequest: null`; set lock duration longer than your slowest stage; keep the processor idempotent.
- **Large audio:** stream R2 → STT (don't load whole files into memory); enforce a max duration; set request timeouts.
- **iOS background upload:** use `URLSessionConfiguration.background`; handle completion via the app delegate handler; the presigned URL must outlive the background window.
- **Sign in with Apple:** verify against **rotating** JWKS (cache + refresh), validate the nonce, handle private-relay emails, and rotate the ES256 client secret (≤6 months).
- **Swift 6 concurrency:** actor-isolate recorder/uploader; `@MainActor` for UI + the SwiftData context; don't suppress warnings.
- **Cost/abuse:** STT + LLM + Chromium add up; enforce per-user limits, max audio length, and concurrency caps; alert on DLQ growth and spend.

---

## 14. Testing

- **Backend unit:** services with providers mocked (Deepgram/OpenAI/Anthropic/R2), severity/DTO mapping, auth token verification.
- **Backend integration:** Prisma against a throwaway Postgres (migrations applied); repository behavior; cascade/soft-delete.
- **Backend e2e:** `supertest` over the real HTTP surface incl. auth guards and per-user isolation.
- **Pipeline test:** fixture audio → assert transcript → sections → PDF produced; mock providers by default, with a flag to run one tiny real clip end-to-end in CI nightly.
- **iOS unit:** `APIClient`, token refresh, sync logic, model mapping (stub the API).
- **Manual device checklist:** offline record → reconnect upload; background upload; Reduce Transparency; Dynamic Type (largest); permission denial; PDF share; reinstall restores data from server.

---

## 15. Env & infra reference

**`server/.env.example`:**
```
NODE_ENV=production
PORT=8080
APP_BASE_URL=https://api.fieldnote.app
DATABASE_URL=postgresql://...        # Railway Postgres (use internal URL in prod)
REDIS_URL=redis://...                # Railway Redis (internal URL)

# Cloudflare R2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=fieldnote
R2_ENDPOINT=https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com

# AI engine
DEEPGRAM_API_KEY=...                 # primary STT (or OPENAI_API_KEY for the alt)
ANTHROPIC_API_KEY=...                # report compilation
REPORT_MODEL=claude-haiku-4-5

# Auth (Sign in with Apple)
APPLE_TEAM_ID=...
APPLE_KEY_ID=...
APPLE_CLIENT_ID=com.viralventures.fieldnote
APPLE_PRIVATE_KEY=...                # .p8 contents (escaped)
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
```
**Railway services:** `api` (start `node dist/main` / `start:api`), `worker` (Dockerfile, start `start:worker`), `postgres`, `redis`. Never commit a real `.env`; add it to `.gitignore`.

**Worker Dockerfile sketch (Puppeteer):** Node base image + Chromium system deps (`apt-get install -y` the standard headless-chromium libraries) or `npx puppeteer browsers install chrome`; run as non-root; launch Chromium with `--no-sandbox --disable-dev-shm-usage`.

**Verify current specifics against docs:** Anthropic models — https://docs.claude.com/en/docs/about-claude/models ; Deepgram — https://developers.deepgram.com ; Railway — https://docs.railway.com ; R2 S3 API — https://developers.cloudflare.com/r2 .

---

## 16. Repo structure

```
fieldnote/
  server/
    src/{app,config,auth,users,jobs,media,processing,pdf,queue,health,common}/
    prisma/{schema.prisma,migrations/}
    test/
    Dockerfile            # worker (chromium)
    package.json          # scripts: start:api, start:worker, prisma:migrate
  ios/
    project.yml           # XcodeGen
    Sources/              # the six (revised) Swift files + new networking/SwiftData
  openapi.json            # generated from @nestjs/swagger; source for the Swift API client
  README.md
```
One Nest codebase, two Railway services (different start commands). Generate `openapi.json` from `@nestjs/swagger` and use it to generate the Swift API client + DTOs so client and server share one contract.

---

## 17. Before you start — confirm only if blocked

Proceed with the §2 decisions by default. Surface these only if they actually block you:
- **Decisions to veto if the human disagrees:** Prisma (vs TypeORM), Deepgram primary (vs OpenAI), Puppeteer (vs `@react-pdf/renderer`), Sign in with Apple as the only auth, SwiftData + LWW sync, BullMQ/Redis.
- **Needed from the human:** Railway project access, R2 bucket + API token, Deepgram + Anthropic keys, Apple Team ID / Key ID / `.p8` / bundle id (`com.viralventures.fieldnote` placeholder otherwise).

Then: read the six iOS starter files, scaffold the monorepo, and begin at **P0**.
