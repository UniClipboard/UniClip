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
- Run manifests and assertions are kept with the task library (`library/t-0252/<run>/`).

## Stage 1 results (fixed APK vs baseline)

| Area | Baseline | Fixed |
| --- | --- | --- |
| Home, service alive, desktop to mobile | pass | pass |
| Home, mobile to desktop in background (3 rounds) | fail 3/3 | pass 3/3 (about 2.7 s) |
| Auxiliary task removed (quick action) | service stopped, "Temporarily stopped" | recorded as `aux_task_removed`, service kept |
| Main task swiped from recents | pause semantics | unchanged, recorded as `task_removed` |
| Notification Pause / Stop | recorded | `userPause` and `userRequest` are distinguishable |
| Process death, restart prompt | prompt restores service | same; the prompt now reports failure instead of a false success |
| API 35+ `onTimeout` | not exercised | handler present; **not-run** (see below) |

Root causes: the default overlay-polling clipboard method required a flag that was only set when switching methods, so
background reads never happened; the Engine host `clipboard_read` now receives the capture the JS observer already made.

## Stage 2 and 3 results (stage-2 APK `001b28eb...`)

| Item | Evidence |
| --- | --- |
| Single process-wide `EngineOwner`; service retains, JS module attaches | Source regression test; Home and process-death scenarios pass. JS-runtime destruction while the service runs is **not-run** (no reliable trigger on the emulator) |
| Foreground type `connectedDevice` (0x10) | `dumpsys activity services` shows type 0x10 |
| Multicast lock held only while running | Held while running, released after Stop (`dumpsys wifi`) |
| Native network hint without JS | `native_network_hint outcome=delivered` after Wi-Fi off/on; peer back online |
| Package replaced | Prompt when enabled; skipped after the user's Stop |
| Boot recovery | After `adb reboot`: decision recorded (`recovery_prompted/systemBoot`), prompt visible, no claim that the service runs, tapping it restores a running service |
| Shizuku binder death / rebind | Listeners existed; a poll-time rebind fallback and dead-object handling were added. **not-run** (no Shizuku on the emulator) |

## Not run

Physical devices and OEM battery managers, lock screen, Doze and App Standby, API 35 emulator, the dataSync timeout hook
(`device_config` override had no effect on the API 36 image, in both builds, so it is a hook failure, not a product result),
Shizuku mode, overlay-event (READ_LOGS) mode, 24 h / 72 h / 7 d runs, Play policy review of `connectedDevice`.
After a reboot or app update the service only resumes through the notification, because capture and history are owned by
the JS runtime; a native-only capture owner is a follow-up.

## Cross-repo observations (not fixed here)

- Engine rc.22 treats up to two text changes within 5 s after a remote write as echoes, so a genuine copy in that window is not synced.
- The overlay window used for background reads steals input focus.
- The CLI `members` command is deprecated.
