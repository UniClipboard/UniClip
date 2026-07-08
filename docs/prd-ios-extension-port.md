# PRD — Porting the Native iOS Share & Keyboard Extensions into the Expo App

Status: Draft / Plan (no code yet)
Author: evaluation synthesized from a 4-agent assessment
Scope: iOS only

> **Port, not migrate.** We carry the existing Swift App Extensions
> (`UniClipboardShare`, `UniClipboardKeyboard`) and the `Shared/` Swift layer
> they need into this Expo project and keep them running as native targets. We do
> **not** rewrite them in React Native / TypeScript.

---

## 1. Goal & Scope

Bring two iOS App Extensions from the native app at
`<native-ios-repo>/UniClipboard` into this Expo (SDK 56 / RN 0.85)
app:

- **Share Extension** — `com.apple.share-services`. Share text / URL / image /
  file from any app into a selected UniClip server. ~751 LOC.
- **Custom Keyboard Extension** — `com.apple.keyboard-service`, Full Access.
  Read/insert clipboard items, two-way sync. ~2100 LOC (largest piece).

Both depend on a shared Swift substrate (`Shared/`, ~3850 LOC): models, an App
Group persistence layer (`SettingsStore`), a pure-Swift `SyncClipboardClient`
(URLSession), and a content-addressed `PayloadCache`.

Out of scope: rewriting any logic in RN; Android; changing the SyncClipboard
wire protocol.

---

## 2. Load-Bearing Findings (verified against source)

These five facts shape the entire plan.

1. **The extensions do NOT use the Rust core.** Neither `UniClipboardShare` nor
   `UniClipboardKeyboard` (nor the `Shared/` files they touch) `import
UniClipboardCore`. They sync over a pure-Swift `SyncClipboardClient`
   (URLSession). Rust is only used by `RustSyncClient.swift` /
   `SyncReducerAdapter.swift` / `ConnectURIRouter.swift`, all gated behind
   `#if UC_RUST_CORE` and never compiled into an extension.
   → **Extension targets must NOT link `UniClipboardCore.xcframework`.** This
   removes the hardest integration risk (xcframework shared across targets) and
   keeps the keyboard under its memory budget.

2. **The extensions do NOT reference the main app target.** They only depend on
   a set of pure-Foundation `Shared/` types. The code is cleanly liftable.

3. **App Group ID is currently mismatched** and must be unified before anything
   works:

   - Native app: `group.app.uniclipboard.UniClipboard`
     (`Shared/Models/SettingsStore.swift:20`)
   - This Expo app's Rust bridge: `group.app.uniclipboard.ios`
     (`modules/uc-core/ios/UcCoreModule.swift:566`)

4. **The Expo app writes nothing to the App Group today.** RN state lives in
   `zustand` + `@react-native-async-storage/async-storage`, which on iOS writes
   to the app's private sandbox — **not** the App Group. The extensions read
   their config/cache exclusively from the App Group. Bridging RN state into the
   App Group in the exact format the extensions expect is the **real work** of
   this port — not the Swift code itself.

5. **Rust binding version has drifted** between the two repos (Expo is newer:
   has `contentId`; native is older: does not). This does **not** affect the
   extensions (they avoid Rust), but matters if/when we reconcile the `Shared/`
   sync layer with the Rust path. Keep using **this** repo's `contentId`-aware
   bindings; do not import the older `RustSyncClient.swift`.

---

## 3. Architecture Decision

### 3.1 Target injection: `@bacons/apple-targets`

`expo prebuild --clean` regenerates `ios/`, so extension targets must be
injected by a config plugin. We adopt **`@bacons/apple-targets`** (Evan Bacon /
Expo team; the de-facto standard). It natively supports both `share` and
`keyboard` target types, places sources under `targets/` (never clobbered by
prebuild), and drives entitlements/App Groups from config. This matches our
existing config-plugin-heavy workflow.

Rejected alternatives:

- **Hand-written `withXcodeProject` pbxproj surgery** — possible (we already use
  `withXcodeProject` in `withRustCore`), but undocumented, fragile target/UUID
  management. Keep as a fallback to patch specific gaps on top of apple-targets.
- **Bare workflow** — abandons CNG and our Android config plugins. Rejected.

### 3.2 The keystone: `SettingsStore` is the single owner of the App Group format

The biggest risk in a RN↔native bridge is **contract drift** — RN writing JSON
that the Swift `JSONDecoder` can't read, silently degrading the extensions to
"no servers configured."

**We eliminate drift by compiling the same `SettingsStore.swift` (and its model
dependencies) into BOTH:**

- the **main app** (as the App Group **writer**, via a thin Expo module), and
- each **extension** (as the App Group **reader**, as today).

The RN ↔ native boundary then carries only plain data (a JSON string / dictionary
of servers + settings). Swift owns encoding _and_ decoding, so the on-disk format
is the same code on both sides and cannot diverge. This is the spine of the plan.

```
┌────────────────────────── App Group container ──────────────────────────┐
│ UserDefaults(suite) keys + container files (format owned by SettingsStore)│
└───────────▲───────────────────────────────────────────────▲─────────────┘
            │ writes (SettingsStore.save*)                    │ reads (SettingsStore.load*)
   ┌────────┴─────────┐                          ┌────────────┴───────────┐
   │  Main app target │                          │  Share / Keyboard ext  │
   │  Expo module     │                          │  (unchanged readers)   │
   │  "app-group-store"│  ◀── RN/TS sync layer    │                        │
   └────────▲─────────┘      (zustand subscribe)  └────────────────────────┘
            │ JS calls (servers JSON, settings JSON, image bytes)
   ┌────────┴─────────┐
   │  zustand stores  │
   └──────────────────┘
```

---

## 4. App Group Data Contract

The single source of truth is `Shared/Models/SettingsStore.swift`. Because we
compile that exact file into both sides, the contract below is **descriptive**
(for review/QA), not a thing RN re-implements. Verify field-by-field against
source before implementation.

App Group ID: **one unified constant** (see §8 open decision), referenced from
`SettingsStore.appGroupID`, the extension entitlements, the main-app
entitlements, and `UcCoreModule.appGroupDir()`.

### 4.1 UserDefaults (suiteName = appGroupID)

| Key (string literal)             | Type / shape                                                                                                                                                                                                                                        | Owner of meaning                                              |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------- | ---------------------------- |
| `server_config_list`             | JSON of `ServerConfigList` → `{ configs: [ServerConfig], activeConfigId }`; `ServerConfig = { id, name?, urls:[String], username, password }` (legacy `url` tolerated == `urls[0]`; `autoSwitchWifiNames`/`autoSwitchStrategy` decoded-and-dropped) | `ServerConfig.swift`, `SettingsStore.loadServers/saveServers` |
| `app_settings`                   | JSON of `AppSettings` (incl. `trustInsecureCert`, `autoApplyServerChanges`, `autoPushDeviceChanges`, `prefetchAttachments`, `prefetchOnCellular`, `payloadCacheMaxBytes`, `appearance`, `keyboardSoundFeedback`, `keyboardHapticFeedback`, …)       | `AppSettings.swift`                                           |
| `server_config`                  | legacy single `ServerConfig` JSON (one-shot migration → `server_config_list`)                                                                                                                                                                       | `SettingsStore` migration                                     |
| `clipboard_history`              | JSON `[ClipboardHistoryItem]` (≤200, newest first); item = `{ id:UUID, entry:Clipboard, timestamp:Date, direction: "pulled"                                                                                                                         | "pushed"                                                      | "local" }` | `ClipboardHistoryItem.swift` |
| `history_modified_after`         | ISO-8601 string (fractional seconds + `Z`)                                                                                                                                                                                                          | `SettingsStore`                                               |
| `last_history_sync_at`           | ISO-8601 string                                                                                                                                                                                                                                     | `SettingsStore`                                               |
| `keyboard_extension_enabled`     | Bool                                                                                                                                                                                                                                                | written by ext, read by app                                   |
| `keyboard_extension_full_access` | Bool                                                                                                                                                                                                                                                | written by ext, read by app                                   |
| `last_synced_change_count`       | Int                                                                                                                                                                                                                                                 | `SettingsStore`                                               |
| `last_synced_content_hash`       | legacy; migrated to file `last_synced_hash`                                                                                                                                                                                                         | `SettingsStore`                                               |

### 4.2 Container files (`containerURL/…`)

| Path                     | Format                                    | Notes                                                                                                             |
| ------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `last_synced_hash`       | plain UTF-8, single uppercase hex SHA-256 | atomic write; bypasses `cfprefsd` per-process cache to prevent §5.4 ping-pong                                     |
| `last_known_ssid`        | plain UTF-8                               | file-backed for cross-process freshness                                                                           |
| `live_urls`              | JSON `{ configId: url }`                  | effective per-config URL chosen by §5.3                                                                           |
| `ImageData/<HASH>.dat`   | raw bytes                                 | `SettingsStore.loadImageData`; filename = uppercase SHA-256                                                       |
| `payloads/<Type>-<HASH>` | raw bytes                                 | `PayloadCache`; **`profileId` filename `<Type>-<HASH>` is load-bearing** for cross-device lookup; 200 MiB LRU cap |

> ⚠️ **Two cache layouts coexist** (`ImageData/` and `payloads/`). Confirm which
> one the RN side must populate before writing the bridge; do not invent a third.
> Must stay compatible with the native app's `FileManager` layout (per
> repo `AGENTS.md` — iOS storage compatibility).

---

## 5. Phased Plan

Ordering principle: **scaffold → bridge → easy extension → hard extension.** Each
phase is independently verifiable.

### Phase 0 — Decisions & prerequisites (0.5 d)

- Resolve §8 open decisions (App Group ID, Sentry, cache layout).
- Confirm CocoaPods ≥1.16.2 / Xcode 16 / macOS 15 toolchain.
- Decide bundle IDs: `app.uniclipboard.ios.Share`, `app.uniclipboard.ios.Keyboard`.

### Phase 1 — Integration scaffold (4–5 d)

1. `npm i @bacons/apple-targets`; add to `app.json` plugins.
2. Add App Group entitlement to the **main app** in `app.json`
   (`ios.entitlements["com.apple.security.application-groups"]`).
3. Unify the App Group ID across `SettingsStore.appGroupID`,
   `UcCoreModule.swift:566`, entitlements, and the apple-targets configs
   (plan a migration for existing Expo users' Rust-written data — see §7).
4. Create `targets/share/` and `targets/keyboard/` with `expo-target.config.js`
   (CommonJS `require`, not ESM/TS). Start with **empty placeholder** targets
   that build, sign, and launch.
5. Stand up iOS EAS for the first time: add
   `extra.eas.build.experimental.ios.appExtensions` (3 bundle IDs + entitlements);
   prepare credentials for main app + 2 extensions.
6. **Exit criteria:** `expo prebuild --clean` + dev build installs with two empty
   extensions visible to the OS; App Group capability provisioned.

### Phase 2 — Shared substrate + data bridge (7–8 d) ← critical path

1. Bring the extension-needed `Shared/` subset into the repo (pure-Foundation
   files only; **exclude** `RustSyncClient`, `SyncReducerAdapter`,
   `ConnectURIRouter`, `SyncClientFactory`, `*+SwiftUI` unless needed):
   `SettingsStore`, `AppSettings`, `ServerConfig`, `Clipboard`, `HistoryRecord`,
   `ClipboardHistoryItem`, `DeviceClipboardSnapshot`, `NetworkContext`,
   `ServerAvatar`, `ServerNameGenerator`, `PayloadCache`, `SyncClipboardClient`,
   `SyncError`, `MultipartBody`, `HistoryQuery`, `SyncClipboardClienting`.
   Organize as a single shared source folder consumed by main app + both
   extensions (apple-targets `_shared` or equivalent) to avoid drift/dupe symbols.
2. Build the **`app-group-store` Expo module** (iOS-only, main-app target):
   wraps `SettingsStore`, decodes RN-provided contract JSON via the same Swift
   models, persists via `SettingsStore` (decode→validate→canonicalize).
   **Full interface design: `docs/design-app-group-store.md`** (API surface,
   contract DTOs, RN→contract field mapping, migration, rebound-guard hook).
3. Build the **TS sync layer**: subscribe to the relevant zustand stores; on
   change, push servers/settings/image bytes into `app-group-store`. One-shot
   backfill on app launch.
4. **Exit criteria:** a unit/manual check that a server configured in the RN app
   appears, byte-identical, when decoded by `SettingsStore` in a test harness.

### Phase 3 — Share Extension (incremental +2–3 d)

1. Copy the 7 `UniClipboardShare/*` files into `targets/share/`.
2. Wire `Info.plist` (activation rules, principal class, `INSendMessageIntent`,
   ATS) and entitlements (App Group only).
3. Sentry: stub `SentryBootstrap`/`SentryDSN` with no-ops (decided §8.2).
4. Rebound guard (decided §8.5, Option A): extend `SyncEngine.ts`
   `getPersistedSynced()` to also read the App Group `last_synced_hash` (new
   `app-group-store.getLastSyncedHash()`), take the newer value, feed in with
   `persistedSyncedContentId = null`. ~8–12 LOC + one module read method.
5. Handle `ShareIntentDonation` cleanup: RN server-delete must call a native hook
   to `deleteAllDonations`, else stale Siri suggestion tiles linger. (Can defer;
   donations are additive.)
6. **Exit criteria:** real-device share of text/image/file into a configured
   server succeeds and shows in history.

### Phase 4 — Keyboard Extension (incremental +3–4 d)

1. Copy the 7 `UniClipboardKeyboard/*` files into `targets/keyboard/`.
2. `Info.plist`: `NSExtensionPointIdentifier=com.apple.keyboard-service`,
   `RequestsOpenAccess=YES`, ATS arbitrary loads, principal class. Entitlements:
   App Group only.
3. Deployment target ≥ iOS 17 (uses `@Observable`); keep `#available` guards for
   iOS 26 APIs already present in the code.
4. **Memory red line:** keyboard target must not link uc-core / xcframework. Keep
   the existing memory-safe paths (ImageIO downsampling, `Data`-only pasteboard
   reads, >8 MB thumbnail skip, `LazyHStack`, `NSCache`).
5. Real-device testing only (Full Access, pasteboard, network can't be validated
   in Simulator). Run Instruments for the 30–60 MB budget.
6. Prepare App Store review notes (clipboard-reading keyboard is sensitive;
   explain user-owned LAN sync, justify `NSAllowsArbitraryLoads`).
7. **Exit criteria:** keyboard installs, Full Access flow works, two-way sync
   round-trips on device within memory budget.

---

## 6. Effort Summary

| Phase                                     | Difficulty | Realistic (person-days) |
| ----------------------------------------- | ---------- | ----------------------- |
| 0 — Decisions                             | 1/5        | 0.5                     |
| 1 — Integration scaffold                  | 3/5        | 4–5                     |
| 2 — Shared + data bridge (shared by both) | 3/5        | 7–8                     |
| 3 — Share extension                       | 4/5        | +2–3                    |
| 4 — Keyboard extension                    | 4/5        | +3–4                    |

- **Both extensions, deduplicated total: ~18–25 person-days.**
- **Share only (Phases 0–3): ~12–15 person-days** — recommended first
  end-to-end slice (lower review risk, smaller code, exercises the full bridge).

---

## 7. Risks & Mitigations

| #   | Risk                                                                                   | Mitigation                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **RN→App Group bridge** is net-new work, not code-moving                               | §3.2 keystone: `SettingsStore` owns format on both sides; bridge passes plain data                                                                                                |
| 2   | App Group ID mismatch → extensions read empty                                          | Phase 1.3 unify; single constant; migrate existing Rust-written data                                                                                                              |
| 3   | Existing Expo users' Rust data under `…ios` group orphaned by ID change                | One-shot migration in `UcCoreModule` / app launch: copy old container → new; or keep `…ios` and repoint native constant instead (decide in §8)                                    |
| 4   | EAS App Group provisioning cache bug (expo/expo #40851)                                | Rebuild ShareExtension profile in Apple Developer Console; `EXPO_NO_CAPABILITY_SYNC` fallback                                                                                     |
| 5   | Keyboard memory (30–60 MB)                                                             | Never link xcframework into keyboard; keep ImageIO/`Data`-only paths; Instruments gate                                                                                            |
| 6   | Keyboard App Store review (reads clipboard + network)                                  | Review notes: user-owned sync, no third-party exfiltration; justify ATS                                                                                                           |
| 7   | SPM→CocoaPods gap (native Sentry is SPM)                                               | Stub Sentry in extensions for v1, or inject CocoaPods Sentry via `pods.rb`                                                                                                        |
| 8   | Rebound: RN engine reads watermark from AsyncStorage, extension writes it to App Group | **Decided (§8.5, Option A):** `getPersistedSynced()` also reads App Group `last_synced_hash`, feeds in with `contentId=null`. Infra exists (`SyncEngine.ts:541`, `index.ts:204`). |
| 9   | Two cache layouts (`ImageData/` vs `payloads/`)                                        | **Decided (§8.3):** both kept, distinct consumers; no RN pre-population for Share; `ImageData/` deferred to keyboard; verify Rust payload path before keyboard phase              |
| 10  | `apple-targets` keyboard support less battle-tested than share                         | Validate empty keyboard target in Phase 1 before porting logic; pbxproj patch as fallback                                                                                         |
| 11  | prebuild clobbers manual Xcode edits                                                   | All native changes via apple-targets `targets/` + config plugins only                                                                                                             |

---

## 8. Decisions (resolved)

1. **App Group ID → `group.app.uniclipboard.UniClipboard` (unified).** Standardize
   everything on the native app's group, per the `AGENTS.md` storage-compat rule.
   Repoint `UcCoreModule.swift:566` from `…ios` to `…UniClipboard`, set the ported
   `SettingsStore.appGroupID` to the same, and add the entitlement to the main app
   - both extensions. **Migrate existing `…ios` data**: one-shot copy of the old
     App Group container → the unified one on first launch after the change (see §7 #3).
2. **Sentry in extensions → stub for v1.** Replace `SentryBootstrap`/`SentryDSN`
   with no-op stubs in the ported Share extension. No CocoaPods Sentry wiring.
3. **Cache layout → keep both, unified container, nothing to pre-populate for
   Share.** `payloads/<Type>-<HASH>` (PayloadCache, written by the Share extension
   itself after upload) and `ImageData/<HASH>.dat` (keyboard-only) are distinct
   caches for distinct consumers — not redundant. The Share milestone needs **no**
   RN cache pre-population. `ImageData/` is deferred to the keyboard phase. Reuse
   the native layout (no new layout invented). **Verify before the keyboard phase:**
   that the Expo Rust core writes payloads to the same `payloads/<Type>-<HASH>`
   path so the two sides don't keep divergent payload caches.
4. **First deliverable → Share-only, end-to-end** (Phases 0–3). Keyboard follows.
5. **Rebound guard → Option A: bridge the App Group `last_synced_hash` into the
   RN engine.** After a push the Share extension writes the App Group file
   `last_synced_hash`; the Expo `SyncEngine` persists its own watermark to
   **AsyncStorage** (`@syncengine:last_synced_hash`) and reads it via
   `getPersistedSynced()` each tick — so the extension's push is invisible and the
   engine would echo it back (the iOS "Allow Paste" prompt + a bounce). Fix:
   `getPersistedSynced()` ALSO reads the App Group `last_synced_hash` (via a new
   `app-group-store.getLastSyncedHash()`), takes the newer value, and feeds it in
   with `persistedSyncedContentId = null`. The infra already exists: the Rust
   reducer handles the "lastSyncedHash drifted / contentId null" case (the
   content-fingerprint idempotency guard, `SyncEngine.ts:541`, commit `cd04335`),
   and `PreambleSnapshot.persistedSyncedContentId` is documented for exactly the
   "Share Extension push path writes null" case (`uc-core/src/index.ts:204`). Est.
   ~0.5–1 d: ~8–12 LOC in `SyncEngine.ts` + one read method on the module.

---

## 9. References

- `@bacons/apple-targets`: https://github.com/EvanBacon/expo-apple-targets
- Expo iOS App Extensions (EAS): https://docs.expo.dev/build-reference/app-extensions/
- Expo iOS capabilities (App Groups auto-sync): https://docs.expo.dev/build-reference/ios-capabilities/
- EAS App Group provisioning cache bug: https://github.com/expo/expo/issues/40851
- Source of truth (native): `<native-ios-repo>/UniClipboard/{UniClipboardShare,UniClipboardKeyboard,Shared}`
- App Group ID locations: `Shared/Models/SettingsStore.swift:20`, `modules/uc-core/ios/UcCoreModule.swift:566`
