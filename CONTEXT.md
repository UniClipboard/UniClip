# Mobile Codebase Context

Use this document for repository orientation. Pair it with `AGENTS.md` for
mandatory platform and storage rules and `DESIGN.md` for UI conventions.

## Product Model

UniClip is an Expo SDK 57 / React Native mobile client for encrypted clipboard
sync across Android, iOS, and desktop devices.

Devices create or join a Space with an invitation code. The mobile app has no
LAN server configuration, server credentials, transport selector, or LAN
fallback. An upgraded user without an existing Space enters Join Space. Local
history remains available while disconnected or before joining.

Tapping a history card opens its details and double-tapping copies it. History
deletion differs by platform: Android hides deleted items at once and offers
Undo, committing the soft delete (which also removes local files) only after the
undo window ends; iOS deletes immediately without undo. A long press enters
multi-select on Android and opens a context menu on iOS.

Clipboard text longer than 1000 UTF-16 units is stored as a full-text file plus
a 200-character preview in the history item's `text` (ending in `...`). The
preview is for list and card display only. Detail, copy, send-to, share, and
sync must use the full-text file. If the file cannot be read, detail, copy,
send-to, and share fall back to the preview, but sync never sends the preview: a
captured long text whose file is unreadable is dropped from capture and left to
the Engine host to read from the clipboard itself.

## Architecture

```text
React Native UI and navigation
  -> UI-facing Zustand stores
  -> focused application services
  -> uc-engine native module
  -> encrypted Space and device-to-device delivery

Local SQLite history and platform file cache remain device-owned.
Each history row has a local incarnation identifier. Deferred deletion compares
that identifier and the row version so eviction and recreation cannot revive an
old delete request. Expired tombstone cleanup rechecks identity, version, deletion
state, and expiry under the same mutation lock. File and image Send jobs copy the current history payload
under its mutation lock and own that temporary copy until the screen releases it.
Batch preparation waits for all copies and releases successful jobs on failure.
iOS App Group storage shares settings, history, payloads, and P2P handoffs with
the Share and Keyboard extensions. Their writer detects optional schema columns,
assigns identities to new v5 rows, and preserves a concurrent writer's row on conflict.
```

`uc-engine` owns P2P identity, Space membership, peer state, invitations,
delivery, and native lifecycle integration. TypeScript services expose smaller
app-facing operations and keep UI components independent from native bindings.

Device-group choice previews use Engine-provided member names, explanations,
and impact. Pending confirmations are not shown as ready to sync, and an
explicitly unavailable impact must not be reconstructed from the current roster.
Legacy responses without the newer fields remain readable.

Engine also owns the five-minute pairing deadline and the final confirmation
fact. Mobile only presents awaiting-peer-confirmation, unconfirmed, or confirmed
from Engine state; it does not start another pairing timer or infer confirmation
from connectivity. An unconfirmed current member remains removable through the
ordinary device-removal action.

After joining, Engine reports one space device update with a phase (updating,
completed, retryable failure, or needs attention), a reason, an optional
recovery, and an optional next retry time. Mobile shows a join as ready only
when Engine reports completed and never infers readiness from devices or
counts. A retryable failure shows automatic retry with Engine's next retry time;
needs attention shows the Engine reason. A review action is offered only when
Engine names a recovery (review devices or update app); a reason without one,
such as a local identity mismatch, can only be dismissed and must not imply a
fix. Responses without the update or maintenance fields read as updating and
healthy.

Engine may also report, per device, a security (group key) update the local
device has not yet seen confirmed: its version, delivery state, recovery, attempt
count, and an optional next retry time. Mobile shows it as pending (waiting, or
the receiver temporarily unavailable) or rejected on device rows and details,
and the overview names the affected devices. Engine owns every retry: refreshing
or restarting only re-reads its state and never resends, and Mobile offers no
manual resend. Guidance follows Engine's recovery, not the state: automatic shows
the next retry time, automatic-on-reconnect retries once after the device
reconnects and is verified, and only review-device asks the user to check that
device. A missing field means nothing is pending.

A join that is still processing is not joined. A join that needs attention
follows Engine's recovery: usually keep the app data and direct the user to
support, but when Engine says to restart with a new invitation, tell the user to
create a new invitation code on the other device and join again. Mobile reads
every Engine join status and rejection reason. Only the sponsor's explicit
authentication rejection is reported as a wrong space password. A sponsor that
was reached but never answered is reported separately, asking the user to open
UniClip on that device and check both are online, and says nothing about the
password. A removed device whose removal other devices have not yet acknowledged
stays listed with an informational status but is not counted as a member.

Both platforms invite devices from the connection sheet in invite mode, which
issues an invitation for the current Space when opened. Only a device confirmed
after that invitation exists counts as newly paired. Invitation issue failures
(Engine codes 1221–1231) map to specific reasons only at the issue-invitation
operation, including the invitation issued while creating a Space, because
Engine reuses those numbers for profile recovery and joining.

Engine persists custom relay addresses and credentials as their single source
of truth. Credentials remain in secure storage on the device; Mobile only shows
whether a credential is configured and submits add, edit, or delete intents.
Mobile never reads or reconstructs credential contents.

On the first relay read after upgrade, Mobile normalizes and deduplicates legacy
`customRelayUrls`, imports only addresses that Engine does not already contain,
and never removes an Engine address. After Engine confirms the import, Mobile
clears the legacy list and uses only the complete list returned by Engine.

Saving relay configuration and reconnecting immediately are separate user
results. A reconnect failure must preserve a successful save and report that
connection retry is in progress; it must not roll back the configuration or
describe the save as failed. Invalid, duplicate, and missing-target results use
specific translatable messages and refresh the latest Engine list rather than
showing internal error text.

Received files report per-item results. Each inbound transfer has an attempt
(receiving, committing, cancelling, failing, completed, failed or cancelled) and
one result per item. A folder is received as one unit; its member count is shown
apart from the item list. An item counts as saved only when Engine reports it
completed. A failed or cancelled attempt can still hold saved files, and saved
files are never retried or deleted because a sibling failed. Engine owns
scheduling, retry, cancellation, supersession and cleanup. Mobile reads Engine
snapshots, treats events only as a signal to read again, and submits two intents:
retry selected failed or cancelled items of the current attempt, or cancel the
attempt. Accepting a retry starts a new attempt and does not mean anything is
saved. Cancellation that is still cleaning up is not shown as cancelled. If the
retry source is gone or access is denied, Mobile says so and keeps the failed items
and saved files. A newer attempt replaces an older one and the list refreshes. When
a refresh fails, Mobile keeps the last known status and marks it stale. The Home
top-bar menu shows "Received files" only while receive attempts exist. The sender's
delivery report is a separate concept and does not say what the receiver saved.

## Key Directories

| Path                                                                 | Purpose                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/screens/`                                                       | App screens and platform-specific screen implementations.                      |
| `src/components/`                                                    | Reusable UI, split by platform when behavior or presentation differs.          |
| `src/features/`, `src/platform/`, `src/support/`, `src/app/runtime/` | User workflows, platform access, diagnostics, and application lifecycle.       |
| `src/stores/`                                                        | UI-facing state for settings, history, clipboard, engine, and Space snapshots. |
| `src/navigation/`                                                    | Top-level tabs, native-stack navigation, and route types.                      |
| `src/utils/`                                                         | Pure helpers and platform-specific file/action adapters.                       |
| `modules/uc-engine/`                                                 | Native P2P engine wrapper and pinned engine artifacts.                         |
| `modules/app-group-store/`                                           | iOS shared settings, history, cache, diagnostics, and handoff storage.         |
| `modules/`                                                           | Other focused Expo native modules.                                             |
| `targets/share/`                                                     | iOS Share Extension.                                                           |
| `targets/keyboard/`                                                  | iOS Keyboard Extension.                                                        |
| `targets/_shared/`                                                   | Swift sources compiled by both iOS extensions.                                 |
| `plugins/`                                                           | Expo config plugins; TypeScript source is compiled into `plugins/build/`.      |

## Main Runtime Surfaces

- `BackgroundServiceManager` starts and refreshes the P2P engine according to
  app lifecycle and background policy.
- `UnifiedEngineService` exposes engine state without leaking native bindings
  into screens.
- Mobile reports connectivity opportunities after engine startup, foreground
  entry, and network changes. Engine owns peer selection, retry, concurrency,
  and cancellation. Manual refresh remains explicit; mobile does not run a
  parallel retry loop or infer an overall refresh result from one online peer.
- Device refreshes keep the last settled device trust snapshot on screen, and
  its actions such as device removal stay available; loading shows only before
  any settled result. Presence and refresh-required events refresh once
  immediately, and further events within 400 ms collapse into one trailing
  refresh while the app is active.
- Events that arrive while the app is in the background do not refresh. When
  the engine reports `running` again after a suspension and the app is active,
  mobile reads the complete space once more, because Android resumes the engine
  natively while the foreground refresh may still be rejected mid-transition.
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
the native-stack navigator. Its main screen hosts three top-level tabs,
Clipboard, Devices, and Settings: a native tab bar on iOS and a floating
navigation pill on Android. Space devices and Space settings live under
Devices, not Settings. Supported external entry points include Android
quick upload, Process Text, system share flows, and the iOS extensions. There is
no Add Server or quick-download route.

## Upgrade Contract

- Preserve local history, cached payloads, P2P identity, and joined Spaces.
- Remove legacy server addresses, usernames, passwords, routing state, and iOS
  shared-container copies.
- Do not create a Space automatically.
- Do not fall back to LAN.
- When no Space exists after upgrade, open Join Space from the Home empty state.

## Rejected Configuration Import

Engine preserves rejected pending configuration data and continues the original
Space. Mobile queries the public binding after startup, session recovery and
foreground recovery. Mobile must not read private Engine files for this status.
The rejection reasons are unsupported format, malformed marker and missing runtime members.

Import status is separate from Engine lifecycle status. Unchecked, checked and
unavailable are distinct states. No rejection record does not confirm import success.
Query failures retain Engine error fields and do not mark a running Engine as failed.
The root notice shows the localized reason and asks the user to re-export with the
new version on the source installation. Closing the notice only closes the notice.
It does not delete or replace data. An unavailable query offers a retry.
Mobile has no configuration-bundle import or replacement UI in this scope.

## iOS Shared Storage Suspension

`AppGroupStore/StorageAccess` owns process-local admission for shared storage.
It contains only Foundation code. `UcEngineCore`, the Expo bridge and Share use
that same owner within each process. Closing admission rejects new operations
and invalidates deferred writes across a later resume. Accepted operations stay
counted until they return. A deadline never reports them as released.

The main lifecycle closes admission before dispatching Engine and JS history
suspension. Its native-files background part waits for accepted native writes.
Only a positive JS release acknowledgement completes the host-files part.
Expiration keeps incomplete owners pending. A stale expiration cannot close a
new foreground generation. Grant-end reports use OSLog, not App Group files. The keyboard.jsonl queue also
checks shared admission and the original visible generation before writing.
Analytics queue writes and delivery acknowledgements use that boundary too.

The keyboard closes admission before transport teardown. `HistoryLog` closes its
SQLite connection from `stopMonitoring` and resumes before `onAppear` reads
history. Failed Engine shutdown retains the Engine and runtime ownership for
cleanup retry. This does not certify the Engine's internal resource release.

Run `python3 e2e/ios-suspension/run.py` and
`node e2e/ios-suspension/run-js.mjs` for host ownership checks. These checks use
temporary data. They do not establish real iOS suspension or Engine acceptance.

## Generated Native Projects

`android/` and `ios/` are generated by Expo prebuild and are not the source of
truth. Native behavior belongs in Expo modules, config plugins, or `targets/`.
After changing native dependencies, regenerate or refresh the platform project
before claiming a platform build is valid.

Commit-pinned Engine artifacts use the `release` profile. Local-source overrides
and `core:prepare:local:ios` use the `dev` profile by default. Pinned builds use
the pinned Engine packaging tools with the selected source checkout. The tools must emit `build-profile.txt`;
development installs reject release or unlabelled cached artifacts.

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
- `docs/network-log.md`: independent Engine network-library log, host configuration, Detailed capture link, diagnostic package section.
- `docs/RELEASE.md`: release and versioning workflow.
- `docs/ios-release-ci.md`: iOS CI, signing, and TestFlight workflow.
