# iOS Upgrade Compatibility Plan (Native → Expo)

> Goal: let existing users of the native iOS app
> (`/Users/mark/MyProjects/iOSApp/UniClipboard`) receive this Expo build as an
> **App Store update (beta)** of the _same_ app — not a fresh install of a
> separate "UniClip" app — with their server config, settings, history and
> cached payloads preserved.

## 0. Status snapshot

| Area        | Item                                                                                             | State              |
| ----------- | ------------------------------------------------------------------------------------------------ | ------------------ |
| Update link | Bundle id (main / Share / Keyboard) unified to `app.uniclipboard.UniClipboard[.Share/.Keyboard]` | ✅ done            |
| Update link | Team `8XG39X5CL8`, App Group `group.app.uniclipboard.UniClipboard`, display name `UniClip`       | ✅ already aligned |
| Update link | Same App Store Connect app record; submitted build number > live                                 | ⏳ manual (ASC)    |
| Data        | Settings/servers **serialization** (suiteName / keys / Codable)                                  | ✅ byte-identical  |
| Data        | Legacy migration will not wipe native data                                                       | ✅ safe            |
| Data        | **RN first-launch overwrites App Group servers with empty defaults**                             | ❌ **P0 blocker**  |
| Data        | History list not read from App Group                                                             | ❌ P1              |
| Data        | Image/file payloads not read from native `payloads/`                                             | ❌ P1              |
| Data        | `mapSettingsToAppGroupDTO` drops several fields                                                  | ⚠️ P2              |

Bundle-id edits already applied:
`app.json:13,74,81`, `targets/share/expo-target.config.js:6`,
`targets/keyboard/expo-target.config.js:6`. The `ios/` directory still holds
old values and must be regenerated (`npx expo prebuild`) before building.

## 1. Root cause: two parallel storage worlds

The Expo project stores data in **two disconnected places**:

- **World A — App Group container** (`group.app.uniclipboard.UniClipboard`),
  used by the Swift extensions and the `modules/app-group-store` native module.
  Its Swift models (`targets/_shared/*.swift`, `modules/app-group-store/ios/Shared/*.swift`)
  are byte-identical to the native app's `Shared/`, so the _format_ is fully
  compatible.
- **World B — RN app sandbox**, used by the screens the user actually sees:
  `expo-file-system` `Paths.document/clipboards/…` (`src/utils/fileStorage.ts:18-21`)
  for files and `AsyncStorage` for config/history
  (`src/services/ConfigStorage.ts`, key `@syncclipboard:config`;
  `@clipboard_history`, `src/constants/index.ts:23`).

The native app wrote everything into World A. After the upgrade the user faces
World B, which ignores World A. That is the entire compatibility gap.

---

## 2. P0 — Stop wiping server config, seed from App Group (RELEASE BLOCKER)

### 2.1 The bug

First launch, no local AsyncStorage config yet:

1. `settingsStore.loadConfig()` (`src/stores/settingsStore.ts:175`) →
   `configStorage.getConfig()` → `ConfigStorage.loadConfig()`
   (`src/services/ConfigStorage.ts:58`) hits the `else` branch (`:75`) and
   returns `DEFAULT_SETTINGS` (empty `servers`, `activeServerIndex: -1`).
2. `loadConfig` then calls `publishConfig(config)` (`:178`) →
   `syncConfigToAppGroup` (`src/services/appGroupSyncCore.ts:94`) →
   `saveServers({configs:[], activeConfigId:null})` + `saveSettings(defaults)`.
3. This atomically overwrites the native `server_config_list` / `app_settings`
   in the App Group. The server config is gone, with no path to recover it
   (`getServers()/getSettings()` are only referenced from `__tests__`).

### 2.2 Fix — seed ConfigStorage from the App Group on first launch

Do it inside `ConfigStorage.loadConfig`'s empty branch, _before_ falling back
to defaults. Once ConfigStorage holds the real config, the later
`publishConfig` pushes the correct values back (idempotent, no data loss), so
no extra guard/sentinel is needed — the branch only runs when there is no local
config, i.e. exactly once.

New file `src/services/appGroupSeed.ts` (iOS-only; returns `null` elsewhere):

```ts
import { Platform } from 'react-native';
import { getServers, getSettings } from 'app-group-store';
import type { AppSettings } from '../types/settings';
import type { ServerConfig } from '../types/api';

/**
 * On first launch of the Expo build over a native install, hydrate the RN
 * config from the App Group written by the native app. Returns a partial
 * AppSettings to merge over DEFAULT_SETTINGS, or null when there is nothing
 * to seed (non-iOS, no module, or empty App Group).
 */
export async function seedConfigFromAppGroup(): Promise<Partial<AppSettings> | null> {
  if (Platform.OS !== 'ios') return null;

  const [serverList, settings] = await Promise.all([getServers(), getSettings()]);
  if (!serverList.configs.length) return null; // nothing worth seeding

  const servers: ServerConfig[] = serverList.configs.map((c) => ({
    type: 'syncclipboard',
    ...(c.name ? { name: c.name } : {}),
    url: c.urls[0] ?? '',
    urls: c.urls,
    username: c.username,
    password: c.password,
  }));

  const activeServerIndex = serverList.activeConfigId
    ? serverList.configs.findIndex((c) => c.id === serverList.activeConfigId)
    : -1;

  // Reverse of mapSettingsToAppGroupDTO (appGroupSyncCore.ts:66-82).
  const partial: Partial<AppSettings> = {
    servers,
    activeServerIndex: activeServerIndex >= 0 ? activeServerIndex : servers.length ? 0 : -1,
  };
  if (settings.trustInsecureCert !== undefined)
    partial.trustInsecureCert = settings.trustInsecureCert;
  if (settings.autoApplyServerChanges !== undefined)
    partial.autoApplyRemote = settings.autoApplyServerChanges;
  if (settings.autoPushDeviceChanges !== undefined)
    partial.autoPushLocal = settings.autoPushDeviceChanges;
  if (settings.payloadCacheMaxBytes !== undefined)
    partial.payloadCacheMaxBytes = settings.payloadCacheMaxBytes;
  if (settings.appearance !== undefined) partial.appearance = settings.appearance;
  if (settings.autoCheckUpdate !== undefined) partial.autoCheckUpdate = settings.autoCheckUpdate;
  if (settings.ignoredVersion !== undefined) partial.ignoredVersion = settings.ignoredVersion;
  if (settings.downloadRelativePath !== undefined)
    partial.downloadRelativePath = settings.downloadRelativePath;

  // attachmentAutoDownload is derived from two booleans (mapAttachmentPrefetch)
  if (settings.prefetchAttachments !== undefined) {
    partial.attachmentAutoDownload = settings.prefetchAttachments
      ? settings.prefetchOnCellular
        ? 'always'
        : 'wifi'
      : 'off';
  }
  // logViewLevelFilter → logLevel, validate against the enum
  if (
    settings.logViewLevelFilter &&
    ['debug', 'info', 'warn', 'error'].includes(settings.logViewLevelFilter)
  ) {
    partial.logLevel = settings.logViewLevelFilter as AppSettings['logLevel'];
  }
  return partial;
}
```

Patch `ConfigStorage.loadConfig` (`src/services/ConfigStorage.ts:75-79`):

```ts
} else {
  const seed = await seedConfigFromAppGroup();          // NEW
  this.config = seed ? { ...DEFAULT_SETTINGS, ...seed } // NEW
                     : { ...DEFAULT_SETTINGS };
  await this.saveConfig();
  await AsyncStorage.setItem(SCHEMA_VERSION_KEY, String(SETTINGS_SCHEMA_VERSION));
}
```

### 2.3 Defensive guard (optional, cheap)

As belt-and-suspenders, in `syncConfigToAppGroup` (`appGroupSyncCore.ts:94`)
skip `saveServers` when the mapped list is empty **and** the App Group already
has servers — so an accidental empty push can never clobber real data.
(Do not block the genuine "user deleted the last server" case; gate the skip on
"local config still equals fresh defaults", not merely "servers empty".)

### 2.4 Field-mapping reference (servers)

| App Group DTO (`AppGroupServerConfigDTO`) | RN `ServerConfig`                                              |
| ----------------------------------------- | -------------------------------------------------------------- |
| `id`                                      | (drop; RN re-derives via `makeUniqueConfigId`)                 |
| `name?`                                   | `name?`                                                        |
| `urls[]`                                  | `urls[]`, and `url = urls[0]`                                  |
| `username`                                | `username`                                                     |
| `password`                                | `password`                                                     |
| `activeConfigId`                          | `activeServerIndex = configs.findIndex(id === activeConfigId)` |

Only `type: 'syncclipboard'` servers exist in the App Group (native app is
SyncClipboard-only), so no WebDAV/S3 handling is needed here.

---

## 3. P1 — Migrate history + payload cache (strongly recommended)

Not a hard blocker (server config survives via P0, so the app re-pulls), but
without it the upgrade _feels_ like a fresh install: history list empties and
every image/file re-downloads.

### 3.1 History

Native store: App Group `UserDefaults["clipboard_history"]` =
JSON `[ClipboardHistoryItem]` (`targets/_shared/ClipboardHistoryItem.swift`,
whose `entry: Clipboard` is `targets/_shared/Clipboard.swift`).
RN store: `AsyncStorage["@clipboard_history"]` = `ClipboardItem[]`
(`src/types/clipboard.ts:25`), managed by `src/services/HistoryStorage.ts`.

Steps:

1. Add native `getLegacyHistory(): Promise<String>` to
   `modules/app-group-store/ios/AppGroupStoreModule.swift` returning the raw
   `clipboard_history` JSON (reuse `SettingsStore`).
2. In a one-time RN migration (guarded by an AsyncStorage sentinel, e.g.
   `@migrated:appgroup_history`), parse and map each row:

   | `ClipboardHistoryItem` (native)         | `ClipboardItem` (RN)                                                              |
   | --------------------------------------- | --------------------------------------------------------------------------------- |
   | `entry.type`                            | `type`                                                                            |
   | `entry.text`                            | `text`                                                                            |
   | `entry.hash`                            | `profileHash` (`?? ''`)                                                           |
   | `entry.hasData`                         | `hasData`, `hasRemoteData`                                                        |
   | `entry.dataName`                        | `dataName`                                                                        |
   | `entry.size`                            | `size`                                                                            |
   | `timestamp` (Date)                      | `timestamp` = epoch ms (also `lastModified`/`lastAccessed`)                       |
   | `direction` (`pulled`/`pushed`/`local`) | `from`; `syncStatus = local ? LocalOnly : Synced`                                 |
   | `id` (UUID)                             | drop; RN keys by its own scheme — confirm in `HistoryStorage`                     |
   | —                                       | `starred:false, version:0, isDeleted:false, pinned:false, isLocalFileReady:false` |

   Set `isLocalFileReady:false` unless the matching payload is also migrated
   (§3.2), so the UI knows to fetch on demand.

3. Insert via `HistoryStorage`'s bulk/import path (read `HistoryStorage.ts` for
   the exact write API and dedup key before wiring this up). Merge, don't
   clobber, if RN already has rows.

### 3.2 Payload cache (image/file)

Native layout: `AppGroup/payloads/<Type>-<hash>` — flat, raw bytes, no
extension (`PayloadCache`). RN layout (`src/utils/fileStorage.ts:18-21,63-65`):

```
Paths.document/clipboards/
  images/<hash><ext>
  files/<hash><ext>
  history/<Type>-<hash>/<dataName>
```

Two options:

- **(P1) Copy-migrate**: expose the App Group `payloads/` path (or a
  `listPayloads()`/`readPayload(name)`) from native, enumerate `<Type>-<hash>`
  files, and copy each into the RN location, deriving `ext`/`dataName` from the
  migrated history row. Skip on mismatch; tolerate re-download.
- **(P2, root fix) Unify the root**: expose the App Group `containerURL` to JS
  and point `BASE_DIR` at it with the flat `payloads/<Type>-<hash>` layout, so
  RN, the Swift extensions, and the native app all share one cache. This is what
  AGENTS.md ("iOS cache layout must match the native app") actually requires and
  removes the app's internal A/B split — but it is a larger change; schedule
  after the beta.

---

## 4. P2 — Settings DTO drift

`mapSettingsToAppGroupDTO` (`appGroupSyncCore.ts:66-82`) omits fields present in
the native `AppSettings` and in the module DTO (`app-group-store/src/index.ts:30-44`),
e.g. `keyboardSoundFeedback`, `keyboardHapticFeedback`, and the
onboarding/extension flags. Every RN settings write therefore resets those
extension-owned flags to default. Fix by either (a) completing the DTO map, or
(b) changing the native `saveSettings` to read-merge-write instead of
overwrite. Low urgency; does not block the beta.

---

## 5. Non-code release prerequisites

1. **Same ASC app record**: confirm `app.uniclipboard.UniClipboard` exists in
   App Store Connect and is the record that shipped the native app. Bundle-id
   parity only helps if the new binary is uploaded to _that_ record.
2. **Build number**: native live build is `12` (`project.pbxproj
CURRENT_PROJECT_VERSION`). The submitted build number must exceed the last
   TestFlight/App Store build. `eas.json` uses `appVersionSource: remote` +
   `autoIncrement`; make sure the remote counter starts above the live value.
3. **Regenerate native project**: `npx expo prebuild -p ios` so `ios/` picks up
   the new bundle ids before archiving.
4. **Version**: `app.json version` is `1.1.0` > native `1.0` — OK.

## 6. Verification (before wide release)

Install the current native app → sign in / add a server → generate history +
copy an image → upgrade in place to the Expo build (same signing identity, via
TestFlight or a same-team local install) → verify:

- [ ] Server config still present, sync works (P0)
- [ ] Settings (appearance, auto-push, etc.) preserved (P0)
- [ ] History list populated, not empty (P1)
- [ ] Previously cached image opens without re-download (P1/P2)
- [ ] No duplicate/orphan files accumulate

## 7. Priority

1. **P0** — required to ship. Without it the upgrade loses server config → app
   unusable.
2. **P1** — strongly recommended for a "seamless" upgrade (history + payloads).
3. **P2** — cleanup / root fix (unify cache root, complete DTO); post-beta.
