# Deploying FieldNote to Railway

This guide stands up the FieldNote backend on [Railway](https://railway.com) as **two
services from one repo** — the HTTP **api** and the BullMQ **worker** — backed by
managed **Postgres** and **Redis**, all on Railway's private network.

The repo is deployed from GitHub: **`https://github.com/jwillz7667/FieldNote.git`**.

> **Why two services, two Dockerfiles?** The api and worker share one NestJS codebase
> but have very different runtimes — only the worker needs headless Chromium (for
> Puppeteer PDF rendering). A single multi-stage Dockerfile with `api` / `worker`
> targets would be ideal, but Railway's config-as-code has **no `target` selector**,
> so each service points at its own Dockerfile:
> [`server/Dockerfile.api`](../server/Dockerfile.api) (lean, no browser) and
> [`server/Dockerfile.worker`](../server/Dockerfile.worker) (+ Chromium + 30 system
> libs). Their `builder` stages are identical; only the runtime differs.

---

## 0. Prerequisites

- A Railway account and a project (create from the dashboard or `railway init`).
- The GitHub repo connected to Railway (Railway's GitHub App needs read access to
  `jwillz7667/FieldNote`).
- Real provider credentials ready: **Cloudflare R2** (account id, access key id,
  secret, bucket, endpoint), **Deepgram** API key, **DeepSeek** API key, **Sign in
  with Apple** (Team ID, Key ID, Services/App client id, `.p8` private key).

---

## 1. Provision the data services

In the project, add the two Railway database plugins:

1. **Postgres** → exposes `${{Postgres.DATABASE_URL}}` (internal) and a public URL.
2. **Redis** → exposes `${{Redis.REDIS_URL}}` (internal) and a public URL.

Always wire the **internal** references (`${{Postgres.DATABASE_URL}}`,
`${{Redis.REDIS_URL}}`) into the app services — private networking keeps traffic off
the public internet and incurs no egress. (Service-reference names depend on what you
name the plugins; the defaults are `Postgres` and `Redis`.)

> Append `?connection_limit=N&pool_timeout=30` to the Postgres URL if you need to cap
> Prisma's pool — size `N` to roughly `WORKER_CONCURRENCY` + api replicas. If you put
> the parameter on `${{Postgres.DATABASE_URL}}` you must reference it as a literal
> string with the params appended in the env value.

---

## 2. Create the **api** service

1. **New Service → GitHub Repo →** `jwillz7667/FieldNote`.
2. **Settings → Source → Root Directory:** `server`. **That is the only source
   setting required.** Railway auto-detects [`server/railway.json`](../server/railway.json)
   (the default config-as-code filename) relative to the root directory — no
   "config path" field to set.

   > ⚠️ **This is the step that's easy to get wrong.** Railway only auto-detects
   > files named exactly `railway.json` or `railway.toml`. A custom name (e.g.
   > `railway.api.json`) is **ignored unless you type its path into the service's
   > config-path field** — and if it's ignored, Railway silently falls back to its
   > **Railpack** auto-builder, which then dies with `No start command detected`
   > (this repo has `start:api`/`start:worker`, no bare `start`). That is exactly the
   > failure this default-named `railway.json` prevents: it forces the **Dockerfile**
   > builder and overrides whatever the dashboard defaulted to.
3. That config pins the builder to [`Dockerfile.api`](../server/Dockerfile.api) and
   sets the health check to `GET /health` (120 s grace) with an `ON_FAILURE` restart
   policy. **Leave the start command empty** — the Dockerfile `CMD` runs
   `prisma migrate deploy` (idempotent, advisory-locked) and then `node dist/main.js`.
4. Add the environment variables from [§4](#4-environment-variables).
5. **Networking → Generate Domain** to get a public `*.up.railway.app` URL (or attach
   a custom domain). Set `APP_BASE_URL` and `CORS_ORIGINS` to match it (see §4).

### Migrations & zero-downtime (optional)

By default the api container migrates on every boot. That's simple and safe for a
single api replica. If you scale the api to **multiple replicas** and want strict
zero-downtime releases, move the migration to a **pre-deploy** step so it runs once
per release before any new container takes traffic:

- In **railway.json** add `"deploy": { "preDeployCommand": "node_modules/.bin/prisma migrate deploy", ... }`, **and**
- change the Dockerfile `CMD` to just `exec node dist/main.js` (drop the inline migrate).

The advisory lock makes the boot-time approach safe even with concurrent replicas
(losers simply see "no pending migrations"), so this is an optimization, not a
correctness fix.

---

## 3. Create the **worker** service

1. **New Service → GitHub Repo →** the **same** `jwillz7667/FieldNote` repo.
2. **Settings → Source:**
   - **Root Directory:** `server`
   - **Config-as-code path:** `railway.worker.json` — **this one you must set
     explicitly.** The auto-detected default (`railway.json`) is the *api's* config,
     so the worker service has to be pointed at its own file by name. (Equivalently,
     set the service variable `RAILWAY_DOCKERFILE_PATH=Dockerfile.worker`.) If you skip
     this, the worker would build the api image (no Chromium) and never render PDFs.
3. That config pins the builder to [`Dockerfile.worker`](../server/Dockerfile.worker)
   and sets an `ON_FAILURE` restart policy. **No health check** — the worker serves no
   HTTP; it's a queue consumer. **Leave the start command empty** — the Dockerfile
   `CMD` runs `node dist/worker.js`.
4. Add the **same** environment variables as the api (§4). The worker needs the AI
   keys, R2, Postgres, and Redis; it does not use `CORS_ORIGINS`/`PORT`, but sharing
   one env set is simplest and harmless. (Use a Railway **shared variable group** to
   define them once and attach to both services.)
5. **Resources:** give the worker **≥ 1 GB RAM**. Headless Chromium is memory-hungry
   and the renderer reuses a single browser; 512 MB risks OOM-kills mid-render. The
   renderer already launches Chrome with `--no-sandbox --disable-setuid-sandbox
   --disable-dev-shm-usage --disable-gpu`, which is required because the container
   runs Chrome as a non-root user with a small `/dev/shm`.

> **Custom Dockerfile name, alternative wiring.** If you'd rather not use a config
> file, Railway also honors the service variable `RAILWAY_DOCKERFILE_PATH` — set it to
> `Dockerfile.api` or `Dockerfile.worker` on the respective service and Railway will
> build that file. The committed `railway.json` / `railway.worker.json` configs are the
> recommended, reviewable source of truth and take precedence.

---

## 4. Environment variables

Set these on **both** services (a shared variable group is ideal). Values mirror
[`server/.env.example`](../server/.env.example); the boot-time zod schema in
`src/config/env.ts` **rejects a missing or malformed value and exits**, so a bad
config fails the deploy fast rather than half-running.

### Runtime
| Variable | Value in production |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `8080` (api; Railway also injects `PORT` — keep them equal) |
| `APP_BASE_URL` | the api's public URL, e.g. `https://fieldnote-api.up.railway.app` |
| `CORS_ORIGINS` | explicit allow-list, **never `*`** in prod (boot refuses a wildcard). Native iOS needs no CORS; list only real web origins, e.g. `https://app.fieldnote.example`. If nothing browser-based calls the API, set it to your own domain. |
| `LOG_LEVEL` | `info` (or `warn`) |

### Data (use Railway internal references)
| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |

### Cloudflare R2
| Variable | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | your R2 account id |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API token pair |
| `R2_BUCKET` | bucket name (e.g. `fieldnote`) |
| `R2_ENDPOINT` | `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `R2_FORCE_PATH_STYLE` | `false` for real R2 (virtual-host works); `true` only for LocalStack/MinIO |
| `R2_PRESIGN_PUT_TTL` / `R2_PRESIGN_GET_TTL` | `3600` / `900` (seconds) |
| `AUDIO_RETENTION_DAYS` | `30` (lifecycle hint; `0` disables) |

### AI engine
| Variable | Value |
| --- | --- |
| `TRANSCRIPTION_PROVIDER` | `deepgram` (or `openai`) |
| `DEEPGRAM_API_KEY` | your Deepgram key (required when provider is `deepgram`) |
| `DEEPGRAM_MODEL` | `nova-3` |
| `OPENAI_API_KEY` / `OPENAI_TRANSCRIBE_MODEL` | only if `TRANSCRIPTION_PROVIDER=openai` |
| `DEEPSEEK_API_KEY` | your DeepSeek key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `REPORT_MODEL` | `deepseek-chat` |
| `MAX_AUDIO_SECONDS` | `5400` |
| `WORKER_CONCURRENCY` | `2` (raise with worker RAM/CPU) |
| `STAGE_TIMEOUT_MS` | `180000` |
| `JOB_MAX_ATTEMPTS` | `3` |
| `USE_MOCK_AI` | `false` (must be false in prod) |

### Auth (Sign in with Apple)
| Variable | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `APPLE_KEY_ID` | the `.p8` key's Key ID |
| `APPLE_CLIENT_ID` | `com.viralventures.fieldnote` (your app/Services id) |
| `APPLE_PRIVATE_KEY` | `.p8` contents — paste the multiline PEM, or a single line with literal `\n` escapes |
| `APPLE_AUTH_DEV_BYPASS` | `false` (**never** `true` in prod) |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` — a fresh secret |
| `JWT_REFRESH_SECRET` | a **different** `openssl rand -base64 48` (boot refuses if equal to the access secret) |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `900` / `2592000` (seconds) |

### Bull-Board dashboard (optional)
| Variable | Value |
| --- | --- |
| `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` | strong basic-auth creds to expose `/admin/queues` on the api; **leave unset to disable** the dashboard in prod |

> **Production guardrails enforced at boot (`src/config/env.ts`):** `NODE_ENV=production`
> rejects (a) any placeholder/`change-me` JWT secret, (b) `JWT_ACCESS_SECRET ==
> JWT_REFRESH_SECRET`, (c) a `*` in `CORS_ORIGINS`, (d) `APPLE_AUTH_DEV_BYPASS=true`
> (real Sign in with Apple is mandatory in prod), and (e) `USE_MOCK_AI=true` (the mock
> providers fabricate reports). Fix the env, not the code. See also
> [`PRODUCTION-HARDENING.md`](./PRODUCTION-HARDENING.md) for the full go-live checklist.

---

## 5. First deploy & verification

1. Trigger a deploy (push to the connected branch, or **Deploy** in the dashboard).
   Both images build from their Dockerfiles. The worker build is the slow one — it
   provisions Chromium and ~30 system libraries.
2. **api** comes up, runs `prisma migrate deploy`, and starts serving. Watch the
   deploy logs for the migration output, then for Nest's "listening on :8080".
3. Health check: `curl https://<api-domain>/health` → `{"status":"ok"}`.
   Readiness (DB + Redis): `curl https://<api-domain>/ready`.
4. **worker** comes up and logs that it's listening on the BullMQ queue.
5. Smoke test the pipeline: from the iOS app (pointed at the api domain) or via the
   API, create a job, upload audio, call `/jobs/:id/process`, and poll `/jobs/:id`
   until `status: READY` with a downloadable PDF. The worker logs one
   `ProcessingEvent` per stage (transcribe → compile → render).

---

## 6. iOS client configuration

Point the app's Release base URL at the api domain (the app sends `Authorization:
Bearer` and reaches R2 only through presigned URLs the api returns — no secrets ship
in the binary). See [`ios/README.md`](../ios/README.md) for where the base URL is set.

---

## 7. Operational notes

- **Scaling:** the api is stateless — raise `numReplicas` (and adopt the pre-deploy
  migration step, §2). The worker scales horizontally too; BullMQ distributes jobs and
  the pipeline is idempotent, so re-runs of a `READY` job are no-ops. Tune throughput
  with `WORKER_CONCURRENCY` per replica against available RAM.
- **Secrets hygiene:** keys live only in Railway env vars. Never commit a real `.env`
  (it's gitignored; only `.env.example` is tracked). Rotate a key in the Railway
  dashboard and redeploy — no code change needed.
- **Redis durability:** BullMQ state lives in Redis. Enable persistence on the Railway
  Redis plugin if you can't tolerate losing in-flight jobs on a Redis restart;
  otherwise failed/lost jobs are re-enqueued by the client's retry/poll loop.
- **Restart policy:** both services restart `ON_FAILURE` up to 10 times — a crash
  loop surfaces in the deploy logs rather than silently flapping forever.
- **Proxy / client IP:** the api sets Express `trust proxy = 1` so it reads the real
  client IP from Railway's `X-Forwarded-For` (one hop). This is what makes the per-IP
  rate limits — the global 100/min and the tight 10/min on `/auth/*` — apply per
  client instead of collapsing onto Railway's edge address.
