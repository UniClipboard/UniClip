# Settings Alignment Design

Unified settings schema for iOS and Android, stored platform-natively (UserDefaults / AsyncStorage),
with a shared TypeScript type definition ensuring semantic parity.

## Principle

- Settings stay in TypeScript/Swift/Kotlin — NOT in Rust core
- Define one canonical schema both platforms implement
- Platform-specific settings live in a separate extension section
- Naming uses camelCase, aligned across both platforms

## Unified Settings Schema

### Category 1: Sync Behavior

| Key                 | Type    | Default | Description                                                  |
| ------------------- | ------- | ------- | ------------------------------------------------------------ |
| `trustInsecureCert` | boolean | false   | Allow self-signed HTTPS certificates (passed to Rust client) |
| `autoApplyRemote`   | boolean | true    | Auto-write server-side changes to device clipboard           |
| `autoPushLocal`     | boolean | false   | Auto-read device clipboard and push to server                |
| `syncOnStartup`     | boolean | true    | Sync immediately on app launch                               |

**Alignment notes:**

- iOS `autoApplyServerChanges` → rename to `autoApplyRemote`
- iOS `autoPushDeviceChanges` → rename to `autoPushLocal`
- Android `autoSync` was conflating both directions → split into two distinct toggles
- Android `syncOnStartup` stays as-is

### Category 2: Attachment & Cache

| Key                      | Type                        | Default           | Description                                   |
| ------------------------ | --------------------------- | ----------------- | --------------------------------------------- |
| `attachmentAutoDownload` | 'wifi' \| 'always' \| 'off' | 'wifi'            | When to prefetch/cache attachments            |
| `payloadCacheMaxBytes`   | number                      | 209715200 (200MB) | Max on-device cache size in bytes             |
| `autoDownloadMaxSize`    | number                      | 5242880 (5MB)     | Skip auto-download for files larger than this |

**Alignment notes:**

- iOS `prefetchAttachments` + `prefetchOnCellular` → unified as `attachmentAutoDownload` enum
- iOS `payloadCacheMaxBytes` → Android should add this
- Android `autoDownloadMaxSize` → iOS should add this (or use a sensible large default)

### Category 3: History

| Key                 | Type    | Default | Description                           |
| ------------------- | ------- | ------- | ------------------------------------- |
| `enableHistorySync` | boolean | true    | Sync history records from server      |
| `maxHistoryItems`   | number  | 1000    | Max history records to retain locally |

**Alignment notes:**

- Android already has both
- iOS has the behavior (watermark-based incremental sync) but no user toggle — add one

### Category 4: Updates

| Key               | Type           | Default | Description                            |
| ----------------- | -------------- | ------- | -------------------------------------- |
| `autoCheckUpdate` | boolean        | true    | Check for updates on launch (daily)    |
| `updateToBeta`    | boolean        | false   | Include beta releases in update checks |
| `ignoredVersion`  | string \| null | null    | Last version user chose to skip        |

**Alignment notes:**

- Both platforms already have `autoCheckUpdate`
- Android has `updateToBeta`, iOS should add it
- iOS has `ignoredVersion`, Android should add it

### Category 5: Appearance

| Key          | Type                          | Default  | Description                           |
| ------------ | ----------------------------- | -------- | ------------------------------------- |
| `appearance` | 'system' \| 'light' \| 'dark' | 'system' | UI theme mode                         |
| `language`   | string                        | 'system' | App language (system = follow device) |

**Alignment notes:**

- Both have theme; Android also has `paletteId` (Android-only extension, see below)
- Android has `language`; iOS follows system language (no user override yet)

### Category 6: Logging & Debug

| Key         | Type                                   | Default | Description                     |
| ----------- | -------------------------------------- | ------- | ------------------------------- |
| `logLevel`  | 'debug' \| 'info' \| 'warn' \| 'error' | 'info'  | Log verbosity                   |
| `debugMode` | boolean                                | false   | Enable developer/debug features |

### Category 7: Downloads

| Key                    | Type   | Default | Description                                        |
| ---------------------- | ------ | ------- | -------------------------------------------------- |
| `downloadRelativePath` | string | ''      | Sub-directory for file downloads (empty = default) |

## Platform-Specific Extensions

These settings exist only on one platform. Each platform stores them alongside the shared
settings but they are not expected to exist on the other platform.

### iOS Only

| Key                            | Type    | Default | Purpose                            |
| ------------------------------ | ------- | ------- | ---------------------------------- |
| `keyboardSoundFeedback`        | boolean | true    | Keyboard extension key-click sound |
| `keyboardHapticFeedback`       | boolean | true    | Keyboard extension haptic feedback |
| `onboardingShown`              | boolean | false   | First-run walkthrough completed    |
| `pastePermissionHintDismissed` | boolean | false   | Paste banner dismissed             |
| `enhancementsPromptShown`      | boolean | false   | Post-pairing carousel shown        |
| `manualUploadDialogShown`      | boolean | false   | Manual upload dialog shown once    |

### Android Only

| Key                            | Type    | Default  | Purpose                                    |
| ------------------------------ | ------- | -------- | ------------------------------------------ |
| `enableBackgroundTasks`        | boolean | false    | Master toggle for all background tasks     |
| `enableBackgroundDownload`     | boolean | false    | Background remote clipboard download       |
| `enableBackgroundUpload`       | boolean | false    | Background local clipboard upload          |
| `enableClipboardOverlay`       | boolean | false    | Invisible overlay for clipboard access     |
| `enableSmsForwarding`          | boolean | false    | Auto-upload SMS verification codes         |
| `enableForegroundNotification` | boolean | true     | Persistent foreground service notification |
| `syncToastEnabled`             | boolean | true     | Toast on sync completion                   |
| `hideFromRecents`              | boolean | false    | Hide from Android recents list             |
| `enableNotifications`          | boolean | true     | Global notification toggle                 |
| `paletteId`                    | string  | 'purple' | Android accent color palette               |
| `remotePollingInterval`        | number  | 3000     | Remote poll interval (ms)                  |
| `localPollingInterval`         | number  | 1000     | Local poll interval (ms)                   |

## Runtime State (NOT settings)

These should be separated from user settings — they are ephemeral state, not user choices:

| Key                      | Current location                     | Should be                      |
| ------------------------ | ------------------------------------ | ------------------------------ |
| `lastSyncedContentHash`  | iOS: file-backed, Android: in-memory | Runtime state store            |
| `lastUpdateCheckDate`    | Android: AppConfig                   | Runtime state store            |
| `needsHistoryReorganize` | Android: AppConfig                   | Runtime state store            |
| `historyModifiedAfter`   | iOS: UserDefaults                    | Runtime state store            |
| `lastHistorySyncAt`      | iOS: UserDefaults                    | Runtime state store            |
| `lastSyncedChangeCount`  | iOS: UserDefaults                    | Runtime state store (keyboard) |

These should live in a separate `RuntimeState` object/key, not mixed into user settings.

## TypeScript Type Definition

```typescript
// src/types/settings.ts

/**
 * Cross-platform settings — both iOS and Android implement these with identical semantics.
 */
export interface SharedSettings {
  // Sync behavior
  trustInsecureCert: boolean;
  autoApplyRemote: boolean;
  autoPushLocal: boolean;
  syncOnStartup: boolean;

  // Attachment & cache
  attachmentAutoDownload: 'wifi' | 'always' | 'off';
  payloadCacheMaxBytes: number;
  autoDownloadMaxSize: number;

  // History
  enableHistorySync: boolean;
  maxHistoryItems: number;

  // Updates
  autoCheckUpdate: boolean;
  updateToBeta: boolean;
  ignoredVersion: string | null;

  // Appearance
  appearance: 'system' | 'light' | 'dark';
  language: string;

  // Logging & debug
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  debugMode: boolean;

  // Downloads
  downloadRelativePath: string;
}

/**
 * Android-only settings.
 */
export interface AndroidSettings {
  enableBackgroundTasks: boolean;
  enableBackgroundDownload: boolean;
  enableBackgroundUpload: boolean;
  enableClipboardOverlay: boolean;
  enableSmsForwarding: boolean;
  enableForegroundNotification: boolean;
  syncToastEnabled: boolean;
  hideFromRecents: boolean;
  enableNotifications: boolean;
  paletteId: string;
  remotePollingInterval: number;
  localPollingInterval: number;
}

/**
 * iOS-only settings.
 */
export interface IosSettings {
  keyboardSoundFeedback: boolean;
  keyboardHapticFeedback: boolean;
  onboardingShown: boolean;
  pastePermissionHintDismissed: boolean;
  enhancementsPromptShown: boolean;
  manualUploadDialogShown: boolean;
}

/**
 * Full app config = shared + platform-specific.
 */
export type AppSettings = SharedSettings & AndroidSettings;
// On iOS (Swift): AppSettings = SharedSettings + IosSettings (defined in Swift struct)
```

## Defaults

```typescript
export const SHARED_DEFAULTS: SharedSettings = {
  trustInsecureCert: false,
  autoApplyRemote: true,
  autoPushLocal: false,
  syncOnStartup: true,

  attachmentAutoDownload: 'wifi',
  payloadCacheMaxBytes: 200 * 1024 * 1024,
  autoDownloadMaxSize: 5 * 1024 * 1024,

  enableHistorySync: true,
  maxHistoryItems: 1000,

  autoCheckUpdate: true,
  updateToBeta: false,
  ignoredVersion: null,

  appearance: 'system',
  language: 'system',

  logLevel: 'info',
  debugMode: false,

  downloadRelativePath: '',
};
```

## Migration Plan

### Android (this project)

1. **Rename fields** in `AppConfig`:

   - `autoSync` → split into `autoApplyRemote` + `autoPushLocal`
   - `theme` → `appearance` (keep `paletteId` as Android-only)
   - `historyImageAutoDownload` → `attachmentAutoDownload` (same values)

2. **Add missing fields**:

   - `trustInsecureCert` (needed for Rust core integration)
   - `payloadCacheMaxBytes`
   - `ignoredVersion`
   - `updateToBeta` (already exists)
   - `downloadRelativePath`

3. **Remove dead/unused fields** from AppConfig:

   - `syncMode` — always 'manual' in practice, the real control is `autoApplyRemote`/`autoPushLocal`
   - `conflictResolution` — unused
   - `enableOfflineQueue`, `maxOfflineQueueSize` — unused
   - `syncLargeFiles`, `largeFileThreshold` — replaced by `autoDownloadMaxSize`
   - `syncInterval` — replaced by `remotePollingInterval`/`localPollingInterval`
   - `syncInBackground` — replaced by `enableBackgroundTasks`

4. **Extract runtime state** to separate storage key:

   - `lastUpdateCheckDate` → runtime state
   - `needsHistoryReorganize` → runtime state

5. **Write migration code** in `ConfigStorage.ts`:
   - On load, if old keys exist, map to new schema
   - One-time migration, bump a schema version

### iOS (native app)

Mirror changes in `AppSettings.swift`:

- Rename `autoApplyServerChanges` → `autoApplyRemote`
- Rename `autoPushDeviceChanges` → `autoPushLocal`
- Merge `prefetchAttachments` + `prefetchOnCellular` → `attachmentAutoDownload` enum
- Add `updateToBeta`, `enableHistorySync`, `maxHistoryItems`, `autoDownloadMaxSize`
- Forward-compatible decode handles missing keys gracefully (existing pattern)

## Settings UI Alignment

Both platforms should expose the same cross-platform settings in the same conceptual order,
even if the UI components differ:

```
Settings Screen
├── Sync
│   ├── Auto-apply remote changes (autoApplyRemote)
│   ├── Auto-push local changes (autoPushLocal)
│   ├── Sync on startup (syncOnStartup)
│   └── Trust insecure certificates (trustInsecureCert)
├── Storage & Downloads
│   ├── Attachment auto-download (attachmentAutoDownload: wifi/always/off)
│   ├── Max auto-download size (autoDownloadMaxSize)
│   ├── Cache size limit (payloadCacheMaxBytes)
│   ├── Download path (downloadRelativePath)
│   └── [Cache usage + clear button]
├── History
│   ├── Enable history sync (enableHistorySync)
│   └── Max items (maxHistoryItems)
├── [Platform-specific section]
│   ├── Android: Background tasks, SMS, permissions...
│   └── iOS: Keyboard, paste permission...
├── Appearance
│   ├── Theme (appearance)
│   └── Android: Color palette (paletteId)
├── Updates
│   ├── Auto-check (autoCheckUpdate)
│   └── Beta updates (updateToBeta)
├── Logs
│   └── Log level (logLevel)
└── About / Debug
```

## What This Does NOT Change

- Storage mechanism (UserDefaults on iOS, AsyncStorage on Android)
- Rust core interface (settings are never passed to Rust except `trustInsecureCert` per-call)
- Settings UI components (each platform has its own native look)
- Platform-specific features (they stay where they are)
