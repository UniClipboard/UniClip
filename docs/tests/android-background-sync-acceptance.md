# Android background sync: acceptance record

Harness: `node e2e/background/run.mjs --app <apk> --peer-cli <uniclip> --label <name> [--scenario a,b] [--rounds N]`.
It creates an owned, disposable emulator and an isolated desktop peer (never a physical device), installs a one-activity
clipboard helper (`e2e/background/clipboard-fixture`) that copies a synthetic string while in the foreground, and writes
`manifest.json`, `timeline.jsonl`, `assertions.json`, `native-journal.jsonl`, `service-log.txt` and `SHA256SUMS`.
Every scenario asserts the intended behaviour, so running it on the old APK records which signals fail there.

## Identity

- Baseline: `b24918a0` (APK sha256 `cb5cb0c4413f6b6eb2ca239386c05986b08140c13a3dd06731b7e13e6c924161`).
- Engine pin: `v1.1.0-rc.22`, `18415aa83a47bd3870c2a1f114b268fc3ed0495a`; desktop peer `@uniclipboard/cli` 1.1.0-alpha.3.
- Device: Android 16 (SDK 36) arm64 google_apis emulator, `APP_VARIANT=test` (targetSdk 36). The host was heavily loaded
  (load average 35-46 on 10 cores), which made the emulator slow; failures were triaged as harness or product before any claim.
- Final APK `54dc928d…` (sha256 prefix) was built from the working tree before the last commits; the product code (`modules`, `src`, `plugins`) is identical to commit `0ea9eb60` and to the branch head, only docs and e2e files changed afterwards.
- Run manifests and assertions are kept with the task library (`library/t-0252/<run>/`); the final regression is `final-s3` (15 scenarios, 53 assertions, all passed), and later runs `consent5` (log consent, overlay-event) and `consent4` (Shizuku missing).

## Stage 1 results (fixed APK vs baseline)

| Area | Baseline | Fixed |
| --- | --- | --- |
| Home, service alive, desktop to mobile | pass | pass |
| Home, mobile to desktop in background (3 rounds) | fail 3/3 | pass 3/3 (about 2.6 s, `final-s1-fixed`) |
| Auxiliary task removed (quick action) | service stopped, "Temporarily stopped" | recorded as `aux_task_removed`, service kept |
| Main task swiped from recents | pause semantics | unchanged, recorded as `task_removed` |
| Notification Pause / Stop | recorded | `userPause` and `userRequest` are distinguishable |
| Process death, restart prompt | prompt restores service | same; the prompt now reports failure instead of a false success |
| API 35+ `onTimeout` | process crash on timeout | handled gracefully (see the timeout section below) |
| `stopService` by the JS runtime ending | cleared nothing | keeps the recovery intent (`runtime_stop`); only the user's setting-off clears it |

Root causes: the default overlay-polling clipboard method required a flag that was only set when switching methods, so
background reads never happened; the Engine host `clipboard_read` now receives the capture the JS observer already made.

## Stage 2 and 3 results (first stage-2 build; the final regression below supersedes it)

| Item | Evidence |
| --- | --- |
| Single process-wide `EngineOwner`; service retains, JS module attaches | Source regression test; Home and process-death scenarios pass. JS-runtime destruction while the service runs is **not-run** (no reliable trigger on the emulator) |
| Foreground type `connectedDevice` (0x10) | `dumpsys activity services` shows type 0x10 |
| Multicast lock held only while running | Held while running, released after Stop (`dumpsys wifi`) |
| Native network hint without JS | `native_network_hint outcome=delivered` after Wi-Fi off/on; peer back online |
| Package replaced | Prompt when enabled; skipped after the user's Stop |
| Boot recovery | After `adb reboot`: decision recorded (`recovery_prompted/systemBoot`), prompt visible, no claim that the service runs, tapping it restores a running service |
| Shizuku binder death / rebind | Listeners existed; a poll-time rebind fallback and dead-object handling were added. **not-run** (no Shizuku on the emulator) |

## Failure modes examined for ownership and serialization

| Failure mode | Cause found in the code | Handling | Evidence |
| --- | --- | --- | --- |
| Service releases its Engine hold while a JS runtime is starting | The runtime was counted as attached only after `start` returned | The module counts itself as attached before starting; start/shutdown/release/lifecycle run under one transition lock | Source review; duplicate-start and Home scenarios pass; owner log lines (counts only) |
| Service main thread waits for a start or shutdown | `onDestroy` released synchronously | Release runs on its own thread; `retain` takes no transition lock | Source review |
| Stop in flight swallows a following start | `startService` returned early while `isRunning` was still true | Early return only when no stop is pending; a START re-enters the foreground and clears the pending-stop flag | Duplicate START x5: one foreground service, one multicast lock, no extra Engine hold, sync still works |
| Activity destroyed on every exit | Not an Engine owner; the Engine and service live in the process | None needed | `always_finish_activities=1`: service stays foreground, mobile to desktop works, the owner log has no shutdown |
| JS bridge destroyed while the service lives | The module's `OnDestroy` now only detaches | Engine kept while the service holds it | **Not reproducible on a release APK** (no trigger short of a developer reload); covered by source review only |
| Security lock | Engine start before the first unlock fails the secure-state recovery | The boot receiver runs after first unlock and never starts the Engine natively | Boot recovery scenario |
| Explicit JS `shutdown` while the service lives | By design the explicit request wins | Documented | Source review |

## Capture ownership: what still needs the JS runtime

All three background reading methods end in the JS clipboard monitor, so `EngineOwner` retaining the Engine keeps the Engine
and its network alive but is **not** sync without JS.

| Piece | Owner | Without a JS runtime |
| --- | --- | --- |
| Rust Engine, peer connections, mDNS, network hint, service, boot prompt | Native | Kept alive; network hint delivered |
| Overlay polling (timer, overlay read) | JS timer calls a native read | No capture |
| Overlay events (logcat trigger thread) | Native thread, but the module stops it when the JS module is destroyed and it delivers to JS | No capture |
| Shizuku poll | Native poll, module stops with JS | No capture |
| History (SQLite), dedupe hash, send decision | JS | No history, no send |
| Engine event loop (`nextEvent`) | JS | Whether inbound content is applied with no consumer was not verified |

The Engine does expose a host-driven capture entry (`observeClipboardChange` with a host `clipboard_read`), and this change feeds it
the capture the JS monitor already made. A native-only capture owner would need the monitors to outlive the JS module and a native
history writer; that is a separate piece of work, not done here.

## Method and permission checks

- Missing overlay permission: Settings shows "Clipboard access still needs permission" with Authorize, never "Ready"; the service is unaffected; granting it restores "Ready".
- ADB events (logcat trigger), consent accepted: a background copy reaches the desktop in about 2.7 s (`final-s3`: 2639 ms) and the native chain `triggered_read`, `emit` is logged; `triggered_read` is reachable only from the system's clipboard-denial log line, so this is the event path and not polling.
- ADB events and the Android 13+ log-access consent ("Allow access to all device logs?", `consent5`): a declined consent leaves the method silent (no delivery, no chain) while Settings still says "Ready"; the next start asks again; accepting makes it work; an accepted consent persists across a restart without a new prompt.
- Why the "Ready" gap is not fixed: the app has no API to query that consent. A probe that runs `logcat` itself to see whether other apps' lines are readable was tried (`consent3`): each probe re-prompted and the persisted consent was no longer kept, so the probe was reverted. A safe fix needs a platform signal that does not exist, or a persisted record of the user's answer.
- Shizuku not installed (`consent4`): Settings shows "Shizuku is not running / Install and start Shizuku, then return to authorize" with Open Shizuku, never "Ready"; the service is unaffected; switching back to timed polling restores "Ready".
- `READ_LOGS` itself is granted at install on this userdebug image, so its absence cannot be produced here.

## Android 15 timeout (dataSync) and the type change

With the compat change `FGS_INTRODUCE_TIME_LIMITS` and `data_sync_fgs_timeout_duration=45000` (the documented test hook), on API 36:

| Build | Result |
| --- | --- |
| Baseline (dataSync, no handler) | Service ended, process replaced (the system's did-not-stop crash), system restart recorded |
| Stage-1 (dataSync, `onTimeout`) | `timed_out/systemTimeout` recorded, service stopped, same process, stop reason `system_timeout` queryable |
| Current (connectedDevice) | Service still foreground after the shortened window; no budget applies |

## connectedDevice: technical conditions and declaration basis (cannot replace Play review)

From the Android documentation (foreground service types; Android 15 behaviour changes; Play foreground-service declaration help):

- `connectedDevice` is "interactions with external devices that require a Bluetooth, NFC, IR, USB, or network connection"; it needs `FOREGROUND_SERVICE_CONNECTED_DEVICE` and at least one of the listed prerequisites. This app declares `CHANGE_WIFI_MULTICAST_STATE` and acquires a multicast lock only while the service runs, for mDNS discovery of the user's own paired devices.
- Android 15 forbids starting `dataSync`, `camera`, `mediaPlayback`, `phoneCall`, `mediaProjection` and `microphone` services from a `BOOT_COMPLETED` receiver and puts `dataSync` on a 6 h per 24 h budget; `connectedDevice` is in neither list. This implementation still does not start the service from the boot receiver (it posts a resume prompt), because there is no JS runtime to sync.
- Play requires, for each used foreground service type when targeting Android 14+, a declaration of the app function, the user impact if the task is deferred or interrupted, and a demonstration video of the user steps; all types are subject to review.
- Suggested declaration text: the user pairs their own phone and computers; the foreground service keeps the encrypted peer connection and local-network discovery alive so clipboard changes sync while the app is closed; if interrupted, sync pauses until the user reopens the app or taps the resume notification.
- Whether Play accepts the type for this use is a platform decision. `specialUse` remains the fallback if it is declined.

## Not run (needs a device or condition not available here)

Physical devices and OEM battery managers, lock screen, Doze and App Standby, API 35 emulator, a running Shizuku (only its absence was tested), a device where `READ_LOGS` is not granted, a real JS-bridge destruction, 24 h / 72 h / 7 d runs, Wi-Fi power cost of the multicast lock, Play review.
No shared or production device or configuration was used; every run used a disposable emulator and an isolated desktop peer, and the leftover peer data of killed runs was removed.

## Known limits

- `EngineOwner` transitions (start, shutdown, release, lifecycle policy) are serialized by one lock, including the secure-state recovery inside `prepare`. JS configuration refreshes are already serialized by `refreshPromise` in `AppRuntime`. The native service state (`isRunning`, `stoppedByUser`) is main-thread state guarded by the pending-stop check, not by that lock.
- An explicit JS `shutdown` wins over the service's hold.
- After a reboot or app update the service resumes only through the notification.
- Intermediate commits were not individually built; the branch head compiles and passes Jest and `tsc`.

## ADB listener recovery change (2026-10-31, automated checks only)

The ADB log reader now owns its process and thread as one generation. An unexpected EOF or read/start failure is recorded
with an exit code when available and at most 512 characters of logcat stderr; clipboard log lines and payloads are not
retained. Recovery is event-driven: only a failed reader schedules retries, after 1, 5 and 15 seconds. Explicit access
denial stops immediately, and exhausting the budget leaves a failed state until a foreground recovery or explicit restart.
Healthy readers block on log input and do not poll the clipboard. Stop cancels retries, and a late old process cannot replace
the new reader. Foreground recovery and native stop/start requests are serialized; enabling/resuming background sync also
recreates the selected ADB monitor. ADB listener failure never enables the one-second clipboard polling timer.

Settings distinguishes ADB/overlay permission from reader lifecycle. A running process is shown as waiting for an event,
not proof that Android granted access to other processes' logs. Only an actual event read updates the read status; it still
does not imply delivery to the peer. Stopped, failed, retrying and unreadable states are visible, with a full-row restart
action. Native lifecycle/read failures are forwarded to the ordinary app diagnostic log. Older native binaries report health
as unavailable instead of inferring it from READ_LOGS.

Six Kotlin process/worker tests cover unexpected exit, successful event-only recovery, bounded retries, explicit log-access
denial, stopping during backoff, and a late old process. TypeScript tests cover foreground recovery, stop/start serialization,
no polling fallback, live Settings health, full-row restart and background-sync enable/resume. See the accompanying task
validation record for actual command results and the tested revision. No physical phone installation or OEM acceptance is
claimed by these checks. Android's one-time consent and OEM background policies remain platform-controlled.

### Port to current main (2026-11-01)

Ported from release `fcf68bfe917fc7a12a3c0696ac90b5463ae0b724` onto
`168972ae0f35755e89e3e7dc8889297aace13f06` (2.4.0.198-alpha.1). Upstream made no changes
to the affected listener, adapter, monitor or BackgroundSection between these revisions.

- Node 22.22.3: all 237 Jest suites / 1,968 tests passed; `npm run type-check`, ESLint on changed
  TypeScript files and `git diff --check` passed. Workspace module builds were prepared first.
- `:clipboard-overlay:testDebugUnitTest --rerun-tasks --no-build-cache --no-daemon`: six tests,
  zero failures, all 73 tasks executed. The target module compiled against the generated Android project.
  Gradle configuration used a local historical Engine AAR; this target does not build or test the Engine.
- No full APK using the new Engine pin (`357d7f64006789285fe5bfc4f025992bc9b84e5f`) was built here.
  Historical APK build evidence applies only to 2.3.0.195 and its own Engine pin.
- Physical Honor phone background delivery, long idle and reboot acceptance remain unverified.
  Unexpected temporary background-sync disablement has not been diagnosed or fixed by this change.
