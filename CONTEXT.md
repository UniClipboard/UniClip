# CONTEXT.md

Orientation document for the UniClip codebase. Read this before making changes;
pair it with `AGENTS.md` (mandatory conventions) and `DESIGN.md` (UI design system).

## What this is

UniClip is a cross-platform clipboard sync mobile client built with **Expo SDK 56 /
React Native 0.85 / React 19**. Primary target is **Android** (shipping); **iOS** is
a parallel native-feel implementation in progress. It syncs clipboard content (text,
image, single file) and history across devices through a self-hosted server.

Supported server backends:
- **SyncClipboard** protocol server (with SignalR push; see below)
- **WebDAV**
- **S3** object storage

App identity: `app.uniclipboard.android` / `app.uniclipboard.ios`, scheme `uniclipboard://`.

## High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React Native UI (src/screens, src/components)               │
│  — platform-split .android.tsx / .ios.tsx files              │
├─────────────────────────────────────────────────────────────┤
│  Zustand stores (src/stores) — UI-facing reactive state      │
├─────────────────────────────────────────────────────────────┤
│  Services (src/services) — I/O, orchestration, lifecycle     │
│    SyncEngine, ClipboardManager, BackgroundServiceManager,   │
│    HistorySyncService, API clients (SyncClipboard/WebDAV/S3) │
├──────────────────────────┬──────────────────────────────────┤
│  uc-core (Rust via UniFFI)│  Native Expo modules (modules/*) │
│  — sync reducer, clipboard│  — foreground service, clipboard │
│    protocol, history DB   │    monitor, SMS, QR, Shizuku...  │
└──────────────────────────┴──────────────────────────────────┘
```

The core sync logic is a **Rust reducer** (`uc-core`). TypeScript owns I/O (network,
clipboard, persistence) and UI; all sync *decisions* route through Rust. This mirrors
the native iOS app's `SyncEngine.swift` so behavior stays identical across platforms.

## Key directories

| Path | Contents |
|------|----------|
| `src/screens/` | Screens: Home, History, Settings, ShareReceive, ProcessText, QuickTile, WordPicker. Platform-split where UI diverges. |
| `src/components/` | Reusable UI; many platform-split (`.android`/`.ios`/`.types`). |
| `src/services/` | Business logic & I/O. See "Services" below. |
| `src/stores/` | Zustand stores (settings, clipboard, history, sync, transfer queue, etc.). |
| `src/theme/` | Material 3 tokens (`colors.ts`) + iOS tokens (`iosDesignTokens.ts`), spacing/radius/typography/motion/elevation. |
| `src/navigation/` | React Navigation setup + `navigationRef` for imperative nav. |
| `src/utils/` | Pure helpers: clipboard, hashing, URL classification, connect-URI parsing, file storage. |
| `src/tasks/` | Background tasks (e.g. SMS code upload). |
| `modules/` | Local Expo native modules (Kotlin/Swift + TS). Each maps to a tsconfig path alias. |
| `rust-core/` | Build scripts that compile the upstream `uniclipboard` Rust crate into `modules/uc-core/`. |
| `plugins/` | Expo config plugins (TS source → `plugins/build/*.js`); wire native manifest/permissions. |
| `ios-shims/` | iOS stubs for Android-only `@expo/ui/jetpack-compose` imports. |
| `web-stubs/` + `App.web.tsx` | Web build stubs (web is a secondary target). |

## Path aliases (tsconfig)

`@/*` → `src/*`, plus `@components`, `@screens`, `@services`, `@stores`, `@types`,
`@utils`, `@constants`, `@navigation`, `@hooks`, `@assets`. Native modules import by
bare name: `uc-core`, `native-util`, `shortcut`, `signalr-client`, `native-timer`,
`clipboard-overlay`, `shizuku-clipboard`, `sms-forwarder`, `foreground-service`,
`qr-scanner`.

## Native modules (`modules/`)

| Module | Purpose |
|--------|---------|
| `uc-core` | **Rust core** via UniFFI. Sync reducer, clipboard protocol client, history DB, hashing. Kotlin/Swift bindings auto-generated; `.so` committed, iOS xcframework built locally. |
| `foreground-service` | Android foreground service to keep clipboard monitoring alive. |
| `clipboard-overlay` | Clipboard read via overlay (Android 10+ background clipboard access workaround). |
| `shizuku-clipboard` | Background clipboard access via Shizuku. |
| `native-timer` | Native interval timer for the 1Hz sync tick. |
| `native-util` | Misc Android utilities (`moveTaskToBack`, exclude-from-recents, etc.). |
| `shortcut` | Dynamic app shortcuts / quick tiles. |
| `signalr-client` | SignalR client for SyncClipboard push notifications. |
| `sms-forwarder` | SMS receiver for auto-forwarding verification codes. |
| `qr-scanner` | QR scanning for the `uniclipboard://connect` provisioning URI. |

## Services (`src/services/`)

- **`SyncEngine.ts`** — Rust-reducer-driven sync state machine. 1Hz foreground tick
  converges device ↔ server clipboards. Conflict resolution is **server-wins**; hash
  dedup (3-layer) prevents echo loops. The TS shell does I/O; `planPreamble` /
  `planAfterServerGet` / `commit*` in Rust make all decisions.
- **`ClipboardManager.ts`** / **`ClipboardMonitor.ts`** — read/write & watch the device clipboard.
- **`BackgroundServiceManager.ts`** — boots & maintains all background services on cold start (called from `App.tsx`).
- **`HistorySyncService.ts`** / **`HistoryAPI.ts`** / **`HistoryStorage.ts`** / **`HistoryTransferQueue.ts`** — history sync, storage, transfer queue.
- **API clients** — `SyncClipboardClient.ts`, `WebDAVClient.ts`, `S3Client.ts`, `APIClient.ts`, `AuthService.ts`.
- **Storage** — `ConfigStorage.ts`, `SecureStorage.ts`, `RuntimeStateStorage.ts`, `CacheManager.ts`, `ConfigMigration.ts`.
- **`UpdateService.ts`** / **`ApkDownloadService.ts`** — in-app update (APK download/install).
- **`URLMetadataService.ts`** — Open Graph metadata for link clipboard cards.

## Platform-split component pattern (CRITICAL)

Per `AGENTS.md`: **never** use `Platform.OS` conditionals inside a shared component.
Split into files:

```
Component.tsx          → export * from './Component.android';  (default/fallback)
Component.android.tsx   → Android (Material 3 / Jetpack Compose via @expo/ui)
Component.ios.tsx       → iOS (Liquid Glass / SwiftUI via @expo/ui)
Component.types.ts      → shared props interface
```

- Android: `@expo/ui/jetpack-compose`, M3 tokens from `@/theme/colors.ts`, Ionicons.
- iOS: `@expo/ui/swift-ui`, `expo-glass-effect`/`expo-blur`, `lucide-react-native`, `PlatformColor()`, tokens from `@/theme/iosDesignTokens.ts`.

Examples: `HomeTopBar.*`, `HomeBottomBar.*`, `ServerSwitcherModal.*`, `ui/GlassContainer.*`.

## App entry & lifecycle (`App.tsx`)

- Loads config → starts `BackgroundServiceManager` → mounts `AppNavigator`.
- Deep-link handling (cold start via `getInitialURL` + hot start via `Linking` event):
  - `uniclipboard://connect?...` — provisioning URI (QR/scan); parsed into `pendingConnectStore`, routes to Settings. **Never logs URI/payload.**
  - `uniclipboard://quick-upload` / `quick-download` — quick-tile sync overlays (exit via `moveTaskToBack` to keep Activity alive for background tasks).
  - `uniclipboard://process-text` — Android "Process Text" selection action.
  - share-intent (`expo-sharing`) — ShareReceive overlay.

## State management

**Zustand** stores under `src/stores/` are the UI-facing reactive layer. Services push
into stores; components subscribe. Settings/config persisted via `ConfigStorage` +
`AsyncStorage`; secrets via `SecureStorage`.

## Build & native code

- **Expo prebuild** generates `android/` & `ios/` (gitignored, regenerated). Config
  plugins in `plugins/` inject native manifest entries & permissions at prebuild time
  — must run `npm run plugin:build` after editing plugin TS.
- **Rust core**: edit upstream `uniclipboard` crate, then `rust-core/scripts/update-bindings.sh`
  to recompile `.so`/bindings into `modules/uc-core/`. Android `.so` committed; iOS
  xcframework built locally (gitignored, ~70MB).
- ABI splits enabled (`withAbiSplits`) for smaller APKs.

## Commands

```bash
npm install            # deps (npm workspaces: modules/*)
npm run prebuild       # expo prebuild --clean (regenerate native projects)
npm run android        # run on Android
npm run ios            # run on iOS
npm run plugin:build   # compile config plugins (plugins/ → plugins/build/)
npm run type-check     # tsc --noEmit
npm run lint           # eslint
npm run test           # jest
npm run build:apk      # release APK
```

## Conventions & gotchas

- **Read the versioned Expo docs** (`https://docs.expo.dev/versions/v56.0.0/`) — SDK 56 differs from older APIs.
- **iOS storage compatibility**: iOS file cache must match the native Swift app at
  `/Users/mark/MyProjects/iOSApp/UniClipboard` (bundle IDs to be unified). Check its
  `FileManager` paths before changing cache layout.
- **Security**: connect-URI handling must never log the URI or payload.
- **Switch components**: ON-track must be green (Android `success`, iOS system green) — not primary/accent.
- iOS new screens must use theme tokens & reuse existing components — no hardcoded colors.
- Conversational language with the user is Chinese; documentation is written in English.

## Reference docs in repo

- `AGENTS.md` — mandatory coding conventions (platform-split, iOS storage). `CLAUDE.md` re-exports it.
- `DESIGN.md` — UI design system / tokens.
- `README.md` — feature overview & dev setup (Chinese).
- `docs/RELEASE.md` — release & versioning workflow.
- `docs/prd-syncclipboard-originhash.md` — origin-hash PRD (in progress).
- `task_plan.md` / `findings.md` / `progress.md` — active working notes (transient).
</content>
</invoke>
