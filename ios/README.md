# FieldNote — iOS

The FieldNote client: a **SwiftUI + SwiftData** app where a home inspector records a
spoken walkthrough and gets back a branded PDF report. The entire product is one
flow — `+` → enter address → record while walking → stop → audio auto-uploads → the
[server](../server) transcribes, compiles, and renders → review/edit → share.

The app is an **offline-first cache**, not the source of truth. It records and
uploads audio, then polls and reconciles canonical state from the server
(last-write-wins by `updatedAt`). It holds **no provider secrets** and touches
object storage only through short-lived presigned URLs.

## Stack & conventions

- SwiftUI + SwiftData, **Swift 6 strict concurrency** (`SWIFT_STRICT_CONCURRENCY:
  complete`), iOS 26 deployment target.
- `APIClient` is an `actor`; `JobStore` / `JobSyncService` are `@MainActor` (the
  SwiftData `ModelContext` is not `Sendable`). The recorder and uploader are isolated
  (`actor AudioRecorder`, a delegate-based `AudioUploader`).
- Tokens live in the Keychain (`KeychainTokenStorage`); auth is Sign in with Apple.
- **Liquid Glass discipline:** glass belongs only to the functional layer floating
  above content (record button, floating `+`, Export/Share, system chrome). Never on
  the content layer (job rows, report/finding cards, backgrounds). The UI stays fully
  usable with **Reduce Transparency** on and at full Dynamic Type; every icon-only
  control has an `accessibilityLabel`.

## Prerequisites

- macOS with **Xcode 26** (the iOS 26 SDK is required — the app builds against
  Liquid Glass APIs and targets iOS 26).
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) — `brew install xcodegen`.

The `.xcodeproj` is **generated** from [`project.yml`](project.yml) and is
gitignored; never edit it by hand.

## Build, run, test

```bash
cd ios
xcodegen generate            # (re)generate FieldNote.xcodeproj from project.yml
open FieldNote.xcodeproj      # then ⌘R to run, ⌘U to test
```

Command line (the scheme is `FieldNote` — no space; the old template scheme is
retired):

```bash
# Build for the simulator
xcodebuild build -scheme FieldNote \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro'

# Run the unit tests
xcodebuild test -scheme FieldNote \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath build/DD

# A single test
xcodebuild test -scheme FieldNote \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:'FieldNoteTests/JobStoreSyncTests/testServerWinsWhenServerIsNewerThanLocalEdit'
```

> **Liquid Glass and accessibility must be verified on a physical iOS 26 device** —
> the simulator under-renders glass.

## Configuration

The backend base URL is the only build-time configuration, injected per build
configuration via the `FN_API_BASE_URL` setting in [`project.yml`](project.yml) →
the `FNAPIBaseURL` Info.plist key → `APIConfig.fromBundle()`:

- **Debug** → `http://localhost:8080` (a locally running [server](../server))
- **Release** → `https://api.fieldnote.app`

There are no secrets in the app or the project file — only a URL. Point a simulator
build at a local server with `USE_MOCK_AI=true` to exercise the whole flow without
cloud credentials.

## Structure

```
Sources/
  App/                 @main entrypoint, root view + environment wiring
  Core/
    Networking/        APIClient (actor), APIConfig, APIError, DTOs
    Security/          Keychain-backed TokenStorage, Apple nonce
    DesignSystem/      theme, haptics
    Extensions/        ISO8601 date parsing
  Data/                JobStore (sync/LWW), SwiftData models, PersistenceController
  Domain/              JobStatus, Severity, SyncState (pure value types)
  Features/
    Auth/              Sign in with Apple, SessionStore
    Jobs/              list, row, sync service, status badge
    Recording/         AudioRecorder (actor), AudioUploader, RecordingView
    Reports/           review, edit, PDF preview, severity badge
Tests/FieldNoteTests/  APIClient transport, JobStore sync/LWW, DTO decoding
Resources/             Assets, Info.plist, entitlements
```

## Tests

`xcodebuild test` runs the `FieldNoteTests` unit suite (handoff §14):

- **`APIClientTests`** — transport contract against a `URLProtocol` stub:
  single-flight 401 refresh-and-retry, session teardown when refresh fails,
  transient-5xx retry, and surfacing the server's problem-JSON message.
- **`JobStoreSyncTests`** — DTO → SwiftData mapping, the last-write-wins rule
  (server-owned fields always adopted; local label/section edits preserved only when
  newer + dirty), and section/finding tree reconciliation (insert/update/prune).
- **`DTODecodingTests`** — wire-format decoding of the API DTOs.
