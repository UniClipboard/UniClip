# Design — `app-group-store` Expo Module (iOS)

Status: Draft / Design (no code yet)
Parent: `docs/prd-ios-extension-port.md` (Phase 2 deliverable)
Scope: iOS only

The bridge that lets the RN app **write** the App Group state the ported Swift
extensions **read**. This is the critical-path component shared by both the Share
and Keyboard extensions, and it is also where the rebound-guard read lives
(PRD §8.5).

---

## 1. Design principle — decode → validate → canonicalize

From PRD §3.2: **`SettingsStore.swift` is the single owner of the App Group
format.** It is compiled into the main app (as writer, via this module) and into
each extension (as reader). To make that real, the module never hand-builds the
stored bytes:

```
TS adapter            native module                       App Group
RN state ──map──▶ contract JSON ──JSONDecoder──▶ Swift struct ──SettingsStore.save──▶ UserDefaults/file
                  (string)        (validate)     (ServerConfigList/   (JSONEncoder, canonical bytes)
                                                  AppSettings)
```

- The boundary value is a **JSON string** matching the Swift `Codable` shape, not
  a `[String: Any]` dict. We decode it with the **real** `JSONDecoder` into the
  **real** structs (`ServerConfigList`, `AppSettings`) — the same types the
  extension decodes — then persist via `SettingsStore.save*`, which re-encodes
  with `JSONEncoder`. The decode step **validates**; the re-encode
  **canonicalizes** (key order, optional omission, date format) so stored bytes
  are byte-for-byte what the extension expects.
- The TS adapter only has to produce JSON that _decodes_; it does not have to
  match encoder output. Format authority stays in Swift.
- A decode failure **rejects to JS** (logged) rather than silently writing a
  half-valid blob — the failure mode "extension shows no servers" becomes a loud
  JS error, not a silent degradation.

---

## 2. Module placement & files

`modules/app-group-store/`, iOS-only (`"platforms": ["ios"]`). Mirrors the
existing `uc-core` module shape.

```
modules/app-group-store/
  expo-module.config.json      # { platforms: ["ios"], ios: { modules: ["AppGroupStoreModule"] } }
  package.json
  tsconfig.json
  src/index.ts                 # typed JS API + contract DTO types
  ios/
    AppGroupStore.podspec      # depends on ExpoModulesCore; pulls in the shared Swift sources
    AppGroupStoreModule.swift  # the Module definition (thin)
    Shared/                    # SAME files compiled into the extensions (single source)
      SettingsStore.swift
      AppSettings.swift
      ServerConfig.swift
      ClipboardHistoryItem.swift
      Clipboard.swift
      ... (the extension-needed Shared subset, see PRD Phase 2.1)
```

`Shared/` is the **single source of truth** consumed by this module _and_ the
apple-targets extension targets (PRD §5 Phase 2.1). Do not fork it.

`SettingsStore.appGroupID` = `group.app.uniclipboard.UniClipboard` (unified, PRD
§8.1). The module hardcodes nothing else; it always goes through `SettingsStore`.

---

## 3. Contract DTOs (TypeScript ⇄ Swift Codable)

These TS types mirror the Swift structs exactly. Defined in
`modules/app-group-store/src/index.ts` and produced by the TS adapter (§6).

```ts
/** Mirrors Swift `ServerConfig` (Shared/Models/ServerConfig.swift). */
export interface ServerConfigDTO {
  id: string; // REQUIRED by Swift decode — see §7 gap G1
  name?: string;
  urls: string[]; // non-empty; urls[0] is canonical (legacy `url` also accepted)
  username: string; // REQUIRED — coerce RN `username?` → "" if absent (§7 G2)
  password: string; // REQUIRED — coerce RN `password?` → "" if absent
}

/** Mirrors Swift `ServerConfigList` (persisted under `server_config_list`). */
export interface ServerConfigListDTO {
  configs: ServerConfigDTO[];
  activeConfigId: string | null; // id of active server, not an index (§7 G3)
}

/**
 * Mirrors Swift `AppSettings`. PARTIAL is allowed: Swift's custom decoder fills
 * missing keys with defaults (AppSettings.swift comment), so the adapter only
 * sends the fields the extensions read. Unknown keys are tolerated.
 */
export interface AppSettingsDTO {
  trustInsecureCert?: boolean;
  autoApplyServerChanges?: boolean;
  autoPushDeviceChanges?: boolean;
  prefetchAttachments?: boolean;
  prefetchOnCellular?: boolean;
  payloadCacheMaxBytes?: number;
  appearance?: 'system' | 'light' | 'dark';
  autoCheckUpdate?: boolean;
  ignoredVersion?: string | null;
  downloadRelativePath?: string;
  // NOTE: main-app-only fields no extension reads (e.g. logViewLevelFilter) are
  // intentionally omitted — Swift fills defaults. See §6.2 / §7.
  // keyboard-phase (omit for Share v1; Swift defaults to true):
  keyboardSoundFeedback?: boolean;
  keyboardHapticFeedback?: boolean;
}
```

---

## 4. JS API surface (phase-tagged)

```ts
// modules/app-group-store/src/index.ts

// ─── Share v1 (Phase 2 + 3) ─────────────────────────────────────────────
/** Decode → validate → persist server list. Rejects on invalid JSON/shape. */
export function saveServers(list: ServerConfigListDTO): Promise<void>;
/** Re-encoded readback of what's stored (verification / reconciliation). */
export function getServers(): Promise<ServerConfigListDTO>;

/** Decode → validate → persist settings (partial allowed). */
export function saveSettings(settings: AppSettingsDTO): Promise<void>;
export function getSettings(): Promise<AppSettingsDTO>;

/** Rebound guard (PRD §8.5): read the App Group `last_synced_hash` file. */
export function getLastSyncedHash(): Promise<string | null>;

/** One-shot migration of the legacy `group.app.uniclipboard.ios` container. */
export function migrateLegacyContainer(): Promise<{ migrated: boolean; keys: number }>;

// ─── Keyboard phase (deferred) ──────────────────────────────────────────
export function putImageData(hash: string, base64: string): Promise<void>; // ImageData/<HASH>.dat
export function getImageData(hash: string): Promise<string | null>; // base64
export function getKeyboardStatus(): Promise<{ enabled: boolean; fullAccess: boolean }>;
export function appendHistory(item: ClipboardHistoryItemDTO): Promise<void>;
export function getHistory(): Promise<ClipboardHistoryItemDTO[]>;
```

Notes:

- All persistence ops are `AsyncFunction` (off the JS thread). Pure-memory reads
  could be `Function`, but keep them async for a uniform Promise API.
- DTOs cross the boundary as objects; the module serializes them to a JSON string
  internally before `JSONDecoder` (or accepts `[String: Any]` and re-serializes —
  prefer passing a pre-stringified payload from TS to avoid `Any` marshalling
  pitfalls already seen on Android, ref memory `expo-android-nested-null-ffi`;
  iOS is unaffected but stringify keeps both platforms honest).

---

## 5. Swift module sketch (thin)

```swift
import ExpoModulesCore

public class AppGroupStoreModule: Module {
  private let store = SettingsStore()                 // App Group-backed
  private let enc = JSONEncoder()
  private let dec = JSONDecoder()

  public func definition() -> ModuleDefinition {
    Name("AppGroupStore")

    AsyncFunction("saveServers") { (json: String) in
      let list = try self.dec.decode(ServerConfigList.self, from: Data(json.utf8))
      self.store.saveServers(list)                    // canonical re-encode
    }
    AsyncFunction("getServers") { () -> String in
      String(data: try self.enc.encode(self.store.loadServers()), encoding: .utf8)!
    }

    AsyncFunction("saveSettings") { (json: String) in
      let s = try self.dec.decode(AppSettings.self, from: Data(json.utf8))
      self.store.saveAppSettings(s)
    }
    AsyncFunction("getSettings") { () -> String in
      String(data: try self.enc.encode(self.store.loadAppSettings()), encoding: .utf8)!
    }

    AsyncFunction("getLastSyncedHash") { () -> String? in
      self.store.loadLastSyncedHash()
    }

    AsyncFunction("migrateLegacyContainer") { () -> [String: Any] in
      try self.migrateLegacy()                        // see §8
    }

    // keyboard-phase functions wrap store.saveImageData / loadImageData / appendHistory …
  }
}
```

TS `index.ts` wraps these, JSON-stringifying DTOs in and `JSON.parse`-ing out:

```ts
const Native = requireNativeModule('AppGroupStore');
export const saveServers = (l: ServerConfigListDTO) => Native.saveServers(JSON.stringify(l));
export const getServers = async () => JSON.parse(await Native.getServers()) as ServerConfigListDTO;
```

---

## 6. TS sync layer (`src/services/appGroupSync.ts`)

The adapter that maps RN domain state → contract DTOs and pushes on change.
iOS-only (`Platform.OS === 'ios'`; no-op elsewhere).

```ts
export function startAppGroupSync() {
  if (Platform.OS !== 'ios') return;
  // 1) one-shot legacy migration, then initial backfill
  AppGroupStore.migrateLegacyContainer().finally(backfill);
  // 2) subscribe; push the relevant slice when it changes
  useSettingsStore.subscribe(selectServersAndSettings, pushBoth, { equalityFn: shallow });
}

function backfill() {
  const { config } = useSettingsStore.getState();
  if (config) pushBoth(selectServersAndSettings({ config }));
}

function pushBoth({ servers, activeIndex, settings }: Slice) {
  AppGroupStore.saveServers(mapServers(servers, activeIndex)).catch(logErr);
  AppGroupStore.saveSettings(mapSettings(settings)).catch(logErr);
}
```

- **Source store:** `useSettingsStore` (`src/stores/settingsStore.ts`) holds
  `config: AppSettings` where `AppSettings = ServerData & SharedSettings &
AndroidSettings`. Read `config.servers`, `config.activeServerIndex`, and the
  `SharedSettings` fields.
- **When to push:** on any change to servers or the mapped settings subset; debounce
  trivially (zustand subscribe with selector). Plus a backfill at app launch.
- **Mapping is the adapter's whole job** (see §7); the module stays format-dumb.

### 6.1 Server mapping (`mapServers`)

RN `ServerConfig` (`src/types/api.ts`) → `ServerConfigDTO`:

| RN field                | → DTO field | Transform                                                                                                                                                                                                                |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url` / `urls[0]`       | `id`        | **G1 (resolved):** id = normalized canonical base URL. RN has no id field; native `ConnectURI.id == url`; Rust keys on `baseUrl` only. So derive the id from the URL — no RN schema change. See §7 G1 for normalization. |
| `name?`                 | `name`      | passthrough                                                                                                                                                                                                              |
| `url`, `urls?`          | `urls`      | `urls?.length ? urls : [url]`; drop empties                                                                                                                                                                              |
| `username?`             | `username`  | `?? ""` (**G2** native decode is non-optional)                                                                                                                                                                           |
| `password?`             | `password`  | `?? ""`                                                                                                                                                                                                                  |
| `type`                  | —           | **filter**: keep only `type === 'syncclipboard'`; drop `webdav`/`s3` (native model is SyncClipboard-only)                                                                                                                |
| `region`,`bucketName`,… | —           | dropped (S3-only)                                                                                                                                                                                                        |

`activeConfigId` = `servers[activeServerIndex]?.id ?? null` (**G3**: index → id).

### 6.2 Settings mapping (`mapSettings`)

RN `SharedSettings` (`src/types/settings.ts`) → `AppSettingsDTO`:

| RN field                 | → DTO field                                      | Transform                                                                                     |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `trustInsecureCert`      | `trustInsecureCert`                              | passthrough                                                                                   |
| `autoApplyRemote`        | `autoApplyServerChanges`                         | rename                                                                                        |
| `autoPushLocal`          | `autoPushDeviceChanges`                          | rename                                                                                        |
| `attachmentAutoDownload` | `prefetchAttachments` + `prefetchOnCellular`     | `'off'`→(false,false), `'wifi'`→(true,false), `'always'`→(true,true)                          |
| `payloadCacheMaxBytes`   | `payloadCacheMaxBytes`                           | passthrough                                                                                   |
| `appearance`             | `appearance`                                     | passthrough (same enum values)                                                                |
| `autoCheckUpdate`        | `autoCheckUpdate`                                | passthrough                                                                                   |
| `ignoredVersion`         | `ignoredVersion`                                 | passthrough                                                                                   |
| `downloadRelativePath`   | `downloadRelativePath`                           | passthrough                                                                                   |
| `logLevel`               | —                                                | **drop** — no extension reads `logViewLevelFilter` (main-app log-viewer filter only). See §7. |
| —                        | `keyboardSoundFeedback`/`keyboardHapticFeedback` | omit for Share v1 (Swift defaults true)                                                       |

**Share-critical subset** (what the Share extension actually reads): `servers`
(`server_config_list`) + `trustInsecureCert` + `appearance`. The rest can land
incrementally, but mapping the full set now de-risks the keyboard phase.

---

## 7. Mapping gaps

- **G1 — server `id` source. RESOLVED: derive from the URL; no RN change.**
  Findings:

  - Swift `ServerConfig.init(from:)` requires `id` (`try c.decode`).
  - RN `ServerConfig` (`src/types/api.ts`) has **no `id`** — `settingsStore`
    identifies servers by **array index** (`addServer`/`deleteServer`/
    `setActiveServer(index)`).
  - Rust `ServerConfig` (uc-core binding) is `{ baseUrl, username, password }` —
    **no id**; `serverFromMap` keys purely on URL+creds.
  - Native `ConnectURI.id` is literally `{ url }` (`ConnectURI.swift:40`) — the
    native server id **is the URL**.

  So server identity across the whole system is the **URL**, and the native
  `id` is just a local App Group key (for `activeConfigId` and `live_urls`
  keying), not anything sent to a server.

  **Resolution:** in `mapServers`, set `id = normalizeBaseURL(urls[0])`.

  - `normalizeBaseURL`: trim trailing slashes; lowercase scheme + host; keep
    port and path. (Match the trimming the native parser/`SyncClipboardClient`
    already does; do **not** invent extra normalization the native side won't
    reproduce.)
  - No RN schema change, no migration. Internal consistency is guaranteed
    because the adapter writes the whole `configs[]` **and** `activeConfigId`
    from the same RN snapshot on every push (§6), so ids and the active pointer
    always agree.
  - Known edge: if the user edits a server's canonical URL, its id changes and
    that server's stale `live_urls` entry is orphaned (harmless; ignored/
    overwritten on next sync). This mirrors native behavior (`id == url`).
  - Fallback (only if edit-stable identity ever becomes a hard requirement):
    add a persisted UUID `id` to RN `ServerConfig`, generated at add-time. Costs
    an RN schema change + migration and diverges from native's `id == url`
    design — not recommended now.

- **G2 — credential optionality.** RN `username?`/`password?` are optional; Swift
  requires both. Coerce `?? ""`. A SyncClipboard server normally has creds, so
  empties should be rare, but decode must not throw.
- **G3 — active selector type.** RN `activeServerIndex: number` vs Swift
  `activeConfigId: string`. Map index→id; `< 0` ⇒ `null`.
- **logLevel — RESOLVED: drop, do not map.** Verified that neither the Share nor
  the Keyboard extension references `logViewLevelFilter`; it appears only in
  `AppSettings.swift` (data model) and is consumed solely by the **main app's**
  log-viewer UI. Native default is `"info"` and the `AppSettings` decoder fills
  it when absent, so the adapter omits `logLevel` entirely. The RN↔native value
  vocabulary mismatch (`warn` vs `warning`, etc.) is therefore moot.

All mapping gaps are now resolved (G1 URL-derived id, G2 `?? ""` coercion, G3
index→id, logLevel dropped). The design is ready to implement.

---

## 8. Legacy container migration (`migrateLegacyContainer`)

One-shot, idempotent. Runs at first launch after the App Group ID change.

1. Resolve old container: `containerURL(forSecurityApplicationGroupIdentifier:
"group.app.uniclipboard.ios")`. If nil → `{ migrated: false, keys: 0 }`.
2. If a migration sentinel exists in the new group → no-op (idempotent).
3. Copy what the Rust core wrote under the old group into the new
   `…UniClipboard` container: payload cache dir + any persisted sync state the
   Rust bridge keeps under `appGroupDir()`. (UserDefaults suite keys too, if the
   old build wrote any.) Use file copy for directories; never delete the source
   until the copy verifies.
4. Write the sentinel; return `{ migrated: true, keys: N }`.

> The Rust bridge's `appGroupDir()` (`UcCoreModule.swift:566`) flips to
> `…UniClipboard` in the same change. Migration ensures in-flight users don't
> lose their cached payloads / sync watermark when the directory moves.

---

## 9. Rebound-guard integration (PRD §8.5)

`getLastSyncedHash()` is consumed by `src/services/SyncEngine.ts`:

- Today `getPersistedSynced()` reads `@syncengine:last_synced_hash` +
  `@syncengine:last_synced_content_id` from AsyncStorage and feeds
  `persistedSyncedHash` / `persistedSyncedContentId` into the preamble snapshot.
- Change: also call `AppGroupStore.getLastSyncedHash()`. If the App Group value
  differs from the AsyncStorage value, the extension pushed since the last tick —
  use the App Group hash and set `persistedSyncedContentId = null` (per
  `uc-core/src/index.ts:204`: the Share/background push path doesn't know the
  contentId). The Rust reducer's content-fingerprint idempotency guard
  (`SyncEngine.ts:541`, commit `cd04335`) handles the contentId-null case.
- Est. ~8–12 LOC in `getPersistedSynced()` + this one read method.

---

## 10. In scope for Share v1 vs deferred

| Capability                                     | Share v1 | Deferred (keyboard) |
| ---------------------------------------------- | -------- | ------------------- |
| `saveServers` / `getServers`                   | ✅       |                     |
| `saveSettings` / `getSettings` (Share subset)  | ✅       | full set            |
| `getLastSyncedHash` (rebound guard)            | ✅       |                     |
| `migrateLegacyContainer`                       | ✅       |                     |
| `putImageData` / `getImageData` (`ImageData/`) |          | ✅                  |
| `getKeyboardStatus`                            |          | ✅                  |
| `appendHistory` / `getHistory`                 |          | ✅ (see note)       |

> **History note:** the Share extension calls `SettingsStore.appendHistory`
> itself (writes App Group `clipboard_history`) so the item shows in the _native_
> Home list. The Expo Home reads its own `historyStore` (RN), not the App Group,
> so a shared item won't appear in Expo Home until RN reads App Group history
> back (a `getHistory()` + merge on app foreground). Out of scope for Share v1;
> the share still uploads and syncs correctly — only the Expo Home log entry is
> missing until the RN read-back lands.

---

## 11. Testing / verification

- **Round-trip unit:** TS `mapServers/mapSettings` output → `saveServers/Settings`
  → `getServers/Settings` returns the same logical data (asserts decode+encode
  parity).
- **Cross-process truth test (the real check, PRD Phase 2 exit):** configure a
  server in the RN app; in a tiny Swift test harness (or the extension itself)
  instantiate `SettingsStore()` and assert `loadServers()` returns it byte-stable.
- **Migration:** seed an old `…ios` container, run `migrateLegacyContainer`,
  assert payloads + state appear under `…UniClipboard` and the sentinel blocks a
  second run.
- **Rebound:** simulate an extension push (write App Group `last_synced_hash`),
  tick the engine, assert no pasteboard apply / no "Allow Paste".
