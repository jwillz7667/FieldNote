# FieldNote

Turn a home inspector's spoken walkthrough into a branded PDF report.

The whole product is one flow: tap `+` → enter the address → record while walking →
stop. The audio uploads automatically; a server-side pipeline transcribes it,
compiles a structured report (sections → findings, each with a severity), and
renders a PDF. The inspector reviews and edits, then shares the PDF. The launch
vertical is home inspection, but the report is template-driven so it generalizes.

> **Source of truth:** [`FieldNote_Production_Handoff.md`](FieldNote_Production_Handoff.md)
> is the full product + architecture spec. Read it before non-trivial work.

## Monorepo layout

```
ios/        SwiftUI + SwiftData client (offline-first cache)      → ios/README.md
server/     NestJS API + BullMQ worker (the AI engine)            → server/README.md
docs/adr/   Architecture Decision Records
openapi.json  Generated API contract (from the server's decorators)
```

## Architecture in one breath

```
 ┌──────────────┐   presigned    ┌─────────────────────────── Railway ──────────────────────────┐
 │  iOS app     │   PUT (audio)  │                                                                │
 │  (SwiftUI)   │ ─────────────► │   R2 ◄── API (NestJS) ──► Postgres                             │
 │  records +   │   HTTPS/JWT    │            │  enqueue        ▲                                  │
 │  uploads     │ ◄───────────►  │            ▼                 │ canonical                        │
 └──────────────┘   jobs CRUD    │   Redis ─► Worker: transcribe → compile → render PDF → READY    │
                    poll/sync    │           (Deepgram)  (DeepSeek)   (Puppeteer)                  │
                                 └────────────────────────────────────────────────────────────────┘
```

Four prime directives govern everything (handoff §1, [ADR 0001](docs/adr/0001-foundational-stack.md)):

1. **"Simple" is a UI/UX rule only** — it constrains the iOS experience, not the backend.
2. **The server is the source of truth** — the app is an offline-first cache that syncs (last-write-wins by `updatedAt`).
3. **AI work is server-side** — the device only records and uploads audio.
4. **No secrets on the client, ever** — provider keys live on the server; the app reaches storage only via short-lived presigned URLs.

## Quickstart

Run the backend with mock AI providers (no cloud keys needed), then build the app
against it:

```bash
# 1. Backend — see server/README.md for detail
cd server
cp .env.example .env            # set USE_MOCK_AI=true for a no-keys run
npm ci && docker compose up -d  # Postgres :5544, Redis :6399, S3 :4566
npm run prisma:migrate:dev
npm run start:dev:api           # :8080 (run the worker in a second shell)
npm run start:dev:worker

# 2. iOS — see ios/README.md for detail (Debug points at http://localhost:8080)
cd ../ios
xcodegen generate && open FieldNote.xcodeproj   # ⌘R to run, ⌘U to test
```

## Tech stack

| | |
| --- | --- |
| **iOS** | SwiftUI + SwiftData, Swift 6 strict concurrency, iOS 26 (Liquid Glass) |
| **Backend** | NestJS 11, Prisma 6 / Postgres 16, BullMQ 5 / Redis 7 |
| **Storage** | Cloudflare R2 (S3 API), presigned URLs only |
| **AI** | Deepgram Nova-3 (transcription), DeepSeek (report compilation), Puppeteer (PDF) |
| **Auth** | Sign in with Apple → app JWT (access + rotating refresh) |
| **Infra** | Railway (`api`, `worker`, `postgres`, `redis`), GitHub Actions CI |

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push/PR:

- **server** — lint + `nest build` + the full test pyramid (unit → e2e against
  Postgres/Redis → integration against Postgres + LocalStack S3 + headless Chromium).
- **ios** — regenerates the project with XcodeGen and runs `xcodebuild test` on a
  simulator. Requires a runner with the iOS 26 SDK (Xcode 26).

## Documentation

- [`FieldNote_Production_Handoff.md`](FieldNote_Production_Handoff.md) — authoritative spec.
- [`server/README.md`](server/README.md) · [`ios/README.md`](ios/README.md) — per-service guides.
- [`docs/DEPLOY-RAILWAY.md`](docs/DEPLOY-RAILWAY.md) — step-by-step Railway deployment (api + worker + Postgres + Redis).
- [`docs/adr/`](docs/adr) — decisions: [0001 foundational stack](docs/adr/0001-foundational-stack.md), [0002 DeepSeek compiler](docs/adr/0002-deepseek-report-compiler.md).
