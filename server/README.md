# FieldNote — Server

The FieldNote backend: a single **NestJS** codebase deployed as two services that
share Postgres, Redis, and R2 over private networking.

- **API** (`dist/main.js`) — auth, jobs CRUD, presigned media URLs, the processing
  trigger, health/readiness, OpenAPI docs, validation, rate limiting.
- **Worker** (`dist/worker.js`) — the AI engine. A BullMQ consumer that walks each
  job through the pipeline: download audio → transcribe → compile a structured
  report → render a PDF → upload it → `READY`.

It is the **source of truth**: Postgres holds canonical data, all AI work happens
here, and provider keys never leave the server. The iOS app reaches storage only
through short-lived presigned URLs.

## Stack

NestJS 11 · Prisma 6 / Postgres 16 · BullMQ 5 / Redis 7 · Cloudflare R2 (S3 API) ·
Deepgram Nova-3 (transcription) · DeepSeek (report compilation, see
[ADR 0002](../docs/adr/0002-deepseek-report-compiler.md)) · Puppeteer (PDF) ·
Sign in with Apple → app JWT. Strict TypeScript (no `any`), zod-validated config.

## Prerequisites

- Node.js ≥ 20 (CI uses 22)
- Docker (for local Postgres / Redis / S3 via `docker-compose.yml`)

## Quickstart (local)

```bash
cp .env.example .env            # fill in real keys, or set USE_MOCK_AI=true
npm ci
docker compose up -d            # Postgres :5544, Redis :6399, LocalStack S3 :4566
npm run prisma:migrate:dev      # create + apply the dev migration
npm run start:dev:api           # API with reload on :8080
npm run start:dev:worker        # (separate shell) worker with reload
```

- API docs (Swagger): `http://localhost:8080/docs`
- Queue dashboard (Bull-Board, basic-auth from `BULL_BOARD_*`): `/admin/queues`
- Health: `GET /health` (liveness) · `GET /ready` (DB + Redis readiness)

> The compose ports match the test harness defaults (`test/e2e-env.ts`), so the
> e2e/integration suites run against the same services with no extra config.

Set `USE_MOCK_AI=true` (auto-enabled when `NODE_ENV=test`) to run the full pipeline
with deterministic mock STT/LLM providers — no external keys, no cost.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run start:api` / `start:worker` | Run the built API / worker (`dist/`). |
| `npm run start:dev:api` / `start:dev:worker` | Watch-mode dev servers. |
| `npm run build` | `nest build` → compiles `dist/main.js` + `dist/worker.js`. |
| `npm run lint` | ESLint (type-checked rules, `--max-warnings 0`). |
| `npm test` | Unit tests (fast, no I/O). |
| `npm run test:e2e` | HTTP e2e suite (real Postgres + Redis). |
| `npm run test:integration` | Worker pipeline against Postgres + S3 + Chromium. |
| `npm run test:cov` | Unit tests with coverage. |
| `npm run prisma:migrate` | `prisma migrate deploy` (production). |
| `npm run prisma:migrate:dev` | Create + apply a dev migration. |
| `npm run openapi:generate` | Regenerate `openapi.json` from the Nest decorators. |

## API surface

All `/jobs` routes require `Authorization: Bearer <accessToken>` and are scoped to
the token's user. Errors are returned as problem JSON (`{ statusCode, error,
message, path }`).

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/apple` | Exchange an Apple identity token for an app JWT pair. |
| `POST` | `/auth/refresh` | Rotate the refresh token, get a new access token. |
| `GET` | `/jobs` | List the caller's jobs (cursor-paginated). |
| `POST` | `/jobs` | Create a job; returns it + a presigned audio upload URL. Honours `Idempotency-Key`. |
| `GET` | `/jobs/:id` | Fetch one job (with its report tree). |
| `PATCH` | `/jobs/:id` | Edit label / sections / findings (last-write-wins). |
| `POST` | `/jobs/:id/process` | Enqueue the pipeline (idempotent on job id). |
| `GET` | `/jobs/:id/pdf` | Presigned download URL for the rendered PDF. |
| `DELETE` | `/jobs/:id` | Soft-delete the job. |
| `GET` | `/health` · `/ready` | Liveness · readiness (DB + Redis). |

The canonical contract is generated: see [`openapi.json`](../openapi.json) at the
repo root, regenerated via `npm run openapi:generate` and used to keep the Swift
client in sync.

## Configuration

Every variable is validated at boot by the zod schema in `src/config/env.ts`; a
missing or malformed value **fails the process immediately**. See
[`.env.example`](.env.example) for the full, commented list. Highlights:

- **Runtime:** `NODE_ENV`, `PORT` (default 8080), `APP_BASE_URL`, `CORS_ORIGINS`, `LOG_LEVEL`.
- **Data:** `DATABASE_URL`, `REDIS_URL`.
- **R2:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  `R2_ENDPOINT`, `R2_FORCE_PATH_STYLE`, presign TTLs, `AUDIO_RETENTION_DAYS`.
- **AI:** `TRANSCRIPTION_PROVIDER` (+ `DEEPGRAM_API_KEY`/`OPENAI_API_KEY`),
  `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `REPORT_MODEL`, pipeline guardrails
  (`MAX_AUDIO_SECONDS`, `WORKER_CONCURRENCY`, `STAGE_TIMEOUT_MS`, `JOB_MAX_ATTEMPTS`),
  `USE_MOCK_AI`.
- **Auth:** `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_CLIENT_ID` / `APPLE_PRIVATE_KEY`
  (and `APPLE_AUTH_DEV_BYPASS` for local only), `JWT_ACCESS_SECRET` /
  `JWT_REFRESH_SECRET` and their TTLs.

**Never commit a real `.env`.** Only `.env.example` is tracked; secrets live in
Railway env vars in production.

## Deploy (Railway)

Two services from this one codebase, sharing managed Postgres + Redis (use the
**internal** URLs in production). Full step-by-step:
**[`docs/DEPLOY-RAILWAY.md`](../docs/DEPLOY-RAILWAY.md)**.

Railway's config-as-code can't select a multi-stage `target`, so api and worker each
have their own Dockerfile and per-service config:

- **api** — [`Dockerfile.api`](Dockerfile.api) (lean, no Chromium) +
  [`railway.api.json`](railway.api.json). Health-checked on `/health`. The container
  runs `prisma migrate deploy` on boot (idempotent, advisory-locked) before serving
  `dist/main.js`, so schema changes apply automatically on release.
- **worker** — [`Dockerfile.worker`](Dockerfile.worker) +
  [`railway.worker.json`](railway.worker.json). Provisions the Puppeteer-matched
  Chromium and its system libraries, runs as a non-root user, and launches Chrome with
  `--no-sandbox --disable-dev-shm-usage`. Give it ≥ 1 GB RAM (Chromium is
  memory-hungry). No health check — it's a queue consumer, not an HTTP server. Runs
  `dist/worker.js`.

```bash
docker build -f Dockerfile.api    -t fieldnote-api    .
docker build -f Dockerfile.worker -t fieldnote-worker .
```

> The image build is not exercised in CI/local here (it pulls a full Chromium); the
> Dockerfile steps (`npm ci`, `prisma generate`, `nest build`, the Puppeteer install
> script, the Debian lib set) are each verified independently — and the worker's
> Debian lib set is mirrored one-for-one by the CI integration job so the bundled
> Chromium launches against the same dependencies the deployed worker uses.

## Testing

A test pyramid (handoff §14):

- **Unit** — pure domain logic: severity ranking, report-schema validation, prompt
  building, env validation. No I/O.
- **e2e** — boots the real Nest app over HTTP (supertest) against Postgres + Redis;
  covers auth, per-user scoping, idempotency, and the jobs lifecycle.
- **Integration** — drives the worker pipeline end-to-end against Postgres +
  LocalStack R2 + real headless Chromium with mock STT/LLM; asserts the status
  machine reaches `READY`, the report + PDF persist, one `ProcessingEvent` per
  stage is written, and a re-run is a no-op.

Each e2e/integration suite isolates itself in a dedicated `fieldnote_test` Postgres
schema that is dropped and re-migrated in `beforeAll`, so it never touches your
`public` data.
