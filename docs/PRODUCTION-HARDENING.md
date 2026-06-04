# Production hardening & go-live runbook

The companion to [`DEPLOY-RAILWAY.md`](./DEPLOY-RAILWAY.md). That guide stands the
services up; this one turns on **real Sign in with Apple** and makes the **profile
database** (the `users` + `refresh_tokens` tables, and everything cascading from a
user) **persistent and hardened** for production.

Split of responsibility:

- **Enforced in code already** — the app *refuses to boot* if these are wrong, so a
  misconfigured deploy fails fast instead of running insecurely.
- **You must do (infra)** — steps that need the Railway dashboard, Apple, and real
  secrets. Claude cannot enter secrets or provision infrastructure on your behalf.

---

## 1. Turn real auth ON (dev-bypass OFF)

The real Apple verifier (`src/auth/apple/real-apple-verifier.ts`) is complete:
it verifies the identity token against Apple's rotating JWKS (RS256 signature,
`iss=https://appleid.apple.com`, `aud=APPLE_CLIENT_ID`, `exp`), and **requires** a
matching nonce. It is selected automatically whenever `APPLE_AUTH_DEV_BYPASS` is false.

**You must do**, on **both** services (api + worker — they share the env contract):

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APPLE_AUTH_DEV_BYPASS` | `false` |
| `APPLE_TEAM_ID` | your Apple Developer Team ID |
| `APPLE_KEY_ID` | the `.p8` key's Key ID |
| `APPLE_CLIENT_ID` | `com.viralventures.fieldnote` (must equal the app's bundle/Services id and the `aud` Apple stamps into the token) |
| `APPLE_PRIVATE_KEY` | the `.p8` contents (multiline PEM, or one line with literal `\n`) |

**Enforced in code:** with `NODE_ENV=production`, boot rejects `APPLE_AUTH_DEV_BYPASS=true`
and (when bypass is off) rejects missing `APPLE_TEAM_ID` / `APPLE_KEY_ID` /
`APPLE_PRIVATE_KEY`. `APPLE_CLIENT_ID` is always required.

**Verify after deploy:**

- A real device Sign in with Apple round-trips to `200` from `POST /auth/apple`.
- A *fake/unsigned* token (what the dev bypass used to accept) now returns `401`
  `Apple identity token failed verification.`
- A sign-in payload **without a nonce** returns `401` `Apple sign-in is missing the
  required nonce.` (downgrade protection).

---

## 2. Make the profile database persistent

1. **Use Railway's managed Postgres** (§1 of the deploy guide), not an ephemeral or
   in-container DB. Managed Postgres is backed by a durable volume that survives
   deploys and restarts.
2. **Wire the internal reference:** `DATABASE_URL = ${{Postgres.DATABASE_URL}}` on both
   services. Private networking keeps DB traffic off the public internet.
3. **Migrations apply on every deploy, idempotently.** `Dockerfile.api`'s start command
   runs `prisma migrate deploy` under a Postgres advisory lock before serving, so
   concurrent replicas are safe and a failed migration fails the release (no
   half-migrated schema).

**Enforced in code:** boot requires a non-empty `postgres…` `DATABASE_URL` — there is
no SQLite/in-memory fallback anywhere, so the app cannot silently come up on
throwaway storage.

---

## 3. Harden the profile database

**You must do (infra):**

- **Automated backups / PITR.** In the Postgres service settings, enable scheduled
  backups (and point-in-time recovery if your plan offers it). Test a restore once.
- **Connection pool sizing.** Append `?connection_limit=N&pool_timeout=30` to
  `DATABASE_URL`, sizing `N` to roughly `WORKER_CONCURRENCY` + api replicas so the
  worker and api don't exhaust Postgres `max_connections`.
- **Transport security.** Keep the **internal** `${{Postgres.DATABASE_URL}}` reference
  (private network, not publicly reachable). If you ever connect an external admin
  tool, use the Postgres **public** URL with `sslmode=require` — do **not** graft
  `sslmode=require` onto the internal URL unless Railway's internal cert chain
  supports it, or boot's connection will fail.
- **Least privilege & exposure.** Don't expose the Postgres public proxy unless needed;
  rotate the DB password from the dashboard if it leaks.

**Already hardened in code (no action needed, listed so you can verify):**

- **Token storage:** refresh tokens are stored only as **SHA-256 hashes** (peppered
  with `JWT_REFRESH_SECRET`), never in plaintext — a DB leak can't replay them.
  Rotation is single-use; reuse of a revoked token revokes the whole active chain.
- **PII minimization:** the only user PII is an optional `email` (often an Apple
  private-relay address) plus Apple's opaque `sub`. Request logs redact the
  `Authorization`/`Cookie` headers and bodies aren't auto-logged; auth code logs only
  `{ userId }`, never the email or token.
- **Per-user isolation:** every job/report query is scoped by `userId` from the JWT at
  the repository layer; a client-supplied `userId` is never trusted.
- **Integrity:** unique constraints (`users.appleSub`, `refresh_tokens.tokenHash`,
  `(userId, idempotencyKey)`) and `onDelete: Cascade` give a clean, consistent
  delete-a-user story (removing a `User` row removes their jobs, sections, findings,
  events, and tokens).
- **Error surface:** the global exception filter returns RFC-7807 problem JSON and
  never leaks stack traces or Prisma internals in production.

---

## 4. Secrets hardening

| Variable | Requirement |
| --- | --- |
| `JWT_ACCESS_SECRET` | fresh `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | a **different** `openssl rand -base64 48` |
| `CORS_ORIGINS` | explicit allow-list — **never** `*` |
| `USE_MOCK_AI` | `false` |
| `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` | strong creds, or leave unset to disable `/admin/queues` entirely |

**Enforced in code:** in production, boot rejects placeholder/`change-me` secrets,
`JWT_ACCESS_SECRET == JWT_REFRESH_SECRET`, a `*` CORS origin, and `USE_MOCK_AI=true`.

---

## 5. Go-live checklist

- [ ] Postgres + Redis provisioned; `DATABASE_URL`/`REDIS_URL` use internal references.
- [ ] Postgres automated backups (+ PITR) enabled and a restore verified.
- [ ] `NODE_ENV=production`, `APPLE_AUTH_DEV_BYPASS=false`, `USE_MOCK_AI=false`.
- [ ] Apple `TEAM_ID`/`KEY_ID`/`CLIENT_ID`/`PRIVATE_KEY` set; real device sign-in → `200`.
- [ ] Distinct, freshly generated JWT secrets; no placeholders.
- [ ] `CORS_ORIGINS` is an explicit allow-list.
- [ ] `/health` → `ok`, `/ready` → DB + Redis healthy.
- [ ] Worker service deployed (Dockerfile.worker, ≥1 GB RAM for Chromium); a job runs
      end-to-end to `READY` with a downloadable PDF.
- [ ] `/admin/queues` is either disabled (creds unset) or behind strong basic auth.

---

## 6. Recommended follow-up (not yet implemented — flagged, out of this change)

- **Account / data deletion endpoint.** The schema fully supports erasing a user
  (cascade deletes), but there is no `DELETE /auth/me` route yet. Apple App Store
  Guideline **5.1.1(v)** requires apps that create accounts to let users delete them.
  A complete implementation would: revoke all of the user's refresh tokens, delete the
  `User` row (cascade), best-effort delete their R2 audio/PDF objects, and best-effort
  call Apple's token-revocation endpoint (`/auth/revoke`) using a client secret signed
  with the `.p8`. This is a new product surface beyond hardening the existing data, so
  it's called out here rather than added silently — say the word and I'll build it.
