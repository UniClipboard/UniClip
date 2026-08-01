# Mobile Codebase Context

Use this document for repository orientation. Pair it with `AGENTS.md` for
mandatory platform and storage rules and `DESIGN.md` for UI conventions.

## Product Model

UniClip is an Expo SDK 56 / React Native mobile client for encrypted clipboard
sync across Android, iOS, and desktop devices.

Devices create or join a Space with an invitation code. The mobile app has no
LAN server configuration, server credentials, transport selector, or LAN
fallback. An upgraded user without an existing Space enters Join Space. Local
history remains available while disconnected or before joining.

## Architecture

```text
React Native UI and navigation
  -> UI-facing Zustand stores
  -> focused application services
  -> uc-engine native module
  -> encrypted Space and device-to-device delivery

Local SQLite history and platform file cache remain device-owned.
iOS App Group storage shares settings, history, payloads, and P2P handoffs with
the Share and Keyboard extensions.
```

`uc-engine` owns P2P identity, Space membership, peer state, invitations,
delivery, and native lifecycle integration. TypeScript services expose smaller
app-facing operations and keep UI components independent from native bindings.

## Key Directories

| Path                       | Purpose                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `src/screens/`             | App screens and platform-specific screen implementations.                                   |
| `src/components/`          | Reusable UI, split by platform when behavior or presentation differs.                       |
| `src/services/`            | Lifecycle, content delivery, Space setup, local history, storage, diagnostics, and updates. |
| `src/stores/`              | UI-facing state for settings, history, clipboard, engine, and Space snapshots.              |
| `src/navigation/`          | Native-stack navigation and route types.                                                    |
| `src/utils/`               | Pure helpers and platform-specific file/action adapters.                                    |
| `modules/uc-engine/`       | Native P2P engine wrapper and pinned engine artifacts.                                      |
| `modules/app-group-store/` | iOS shared settings, history, cache, diagnostics, and handoff storage.                      |
| `modules/`                 | Other focused Expo native modules.                                                          |
| `targets/share/`           | iOS Share Extension.                                                                        |
| `targets/keyboard/`        | iOS Keyboard Extension.                                                                     |
| `targets/_shared/`         | Swift sources compiled by both iOS extensions.                                              |
| `plugins/`                 | Expo config plugins; TypeScript source is compiled into `plugins/build/`.                   |

## Main Runtime Surfaces

- `BackgroundServiceManager` starts and refreshes the P2P engine according to
  app lifecycle and background policy.
- `UnifiedEngineService` exposes engine state without leaking native bindings
  into screens.
- `UnifiedSpaceService` owns create, join, invitation, device, and leave-space
  operations.
- `UnifiedContentService` is the single outbound entry for text, images, files,
  and the current clipboard.
- `P2pClipboardObserver` and `ClipboardMonitor` coordinate inbound and local
  clipboard changes.
- `HistoryStorage` persists local history independently from settings and Space
  membership.
- `ConfigMigration` and App Group legacy cleanup may still read old LAN keys.
  These names exist only to delete old credentials during upgrade; they are not
  runtime compatibility paths.

## Native Modules

| Module               | Purpose                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `uc-engine`          | Space identity, encryption, peer state, delivery, and lifecycle.   |
| `app-group-store`    | Shared iOS settings, history, payloads, diagnostics, and handoffs. |
| `foreground-service` | Android foreground lifecycle support.                              |
| `clipboard-overlay`  | Android clipboard access and monitoring support.                   |
| `shizuku-clipboard`  | Optional Android clipboard access through Shizuku.                 |
| `native-timer`       | Native timer support used by background behavior.                  |
| `android-util`       | Android system integrations.                                       |
| `document-exporter`  | Native document export.                                            |
| `shortcut`           | Android shortcuts and quick actions.                               |

## Platform Components

Never branch on `Platform.OS` inside shared UI. Follow `AGENTS.md`:

```text
Component.tsx           -> exports the Android fallback
Component.android.tsx   -> Android implementation
Component.ios.tsx       -> iOS implementation
Component.types.ts      -> shared props
```

Examples include `HomeTopBar.*`, `HomeBottomBar.*`,
`AddSyncConnectionSheet.*`, and `ui/GlassContainer.*`.

## Entry And Lifecycle

`App.tsx` loads settings, initializes local history and the engine, and mounts
the native-stack navigator. Supported external entry points include Android
quick upload, Process Text, system share flows, and the iOS extensions. There is
no Add Server or quick-download route.

## Upgrade Contract

- Preserve local history, cached payloads, P2P identity, and joined Spaces.
- Remove legacy server addresses, usernames, passwords, routing state, and iOS
  shared-container copies.
- Do not create a Space automatically.
- Do not fall back to LAN.
- When no Space exists after upgrade, open Join Space from the Home empty state.

## Generated Native Projects

`android/` and `ios/` are generated by Expo prebuild and are not the source of
truth. Native behavior belongs in Expo modules, config plugins, or `targets/`.
After changing native dependencies, regenerate or refresh the platform project
before claiming a platform build is valid.

## Commands

```bash
npm install
npm run type-check
npm run lint
npm test -- --runInBand
npm run plugin:build
npm run core:verify
npx expo export
npm run build:apk
```

For iOS, prepare the engine, run Expo prebuild, install Pods, and build the
generated workspace as described in `docs/ios-release-ci.md`.

## References

- `AGENTS.md`: mandatory project conventions.
- `DESIGN.md`: visual and interaction rules.
- `docs/RELEASE.md`: release and versioning workflow.
- `docs/ios-release-ci.md`: iOS CI, signing, and TestFlight workflow.
