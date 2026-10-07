# Android power metrics: acceptance record

Contract: `docs/specs/006-android-power-metrics.md`. Rerun: `node e2e/power/run.mjs --apk <debuggable release apk> --serial emulator-<port> --out <dir>`
(owned, disposable emulator only; it changes battery/Doze/network state and reboots). Build the APK as in `e2e/README.md`, then set
`debuggable true` on the generated `android/app/build.gradle` release type so `adb run-as` can read the app's own sample file.

## Identity of the recorded run

- Source: branch `hp/uni/t-0193-android` on top of `0678dfbb`; the run's `environment.json` records the exact commit and dirty files.
- Engine pin: `v1.1.0-rc.22`, source `18415aa83a47bd3870c2a1f114b268fc3ed0495a`, AAR from the release manifest (`modules/uc-engine/core-source.json`).
- Device: Android 16 (SDK 36) arm64 emulator `sdk_gphone64_arm64`, AVD `uc-power-e2e-0193`, created for this run.
- Phases: 120 s per phase; calibration window about 122 s.

## Measured (emulator, real app, real Engine with an isolated disposable space)

| Check | Result |
| --- | --- |
| Samples recorded at real boundaries (process start, foreground/background, screen on/off, plug/unplug, Doze, service start, Engine start, network change, query, reset) | 38 samples, 0 malformed, 0 dropped, 0 write failures |
| CPU calibration over a 121.6 s screen-off window | App record 3867 ms; `dumpsys batterystats` UID delta 3859 ms (0.2 %); `/proc/<pid>/stat` delta 3800 ms |
| Network calibration over the same window | Recorded rx 411 152 B / tx 226 622 B; OS stats (`batterystats` nt line, wifi+mobile) rx 405 394 B / tx 224 535 B (+1.4 % / +0.9 %, edge timing of two exports) |
| Process crash, force-stop, reboot | `prevExit` reasons `crash`, `userRequested`, `noExitRecord`; gaps reported as uncovered, never zero-filled; process counters not differenced across processes |
| Doze, charging, offline/online | Doze time and charging windows attributed; charging windows excluded from discharge numbers |
| UI | Power section renders on the diagnostics page; trailing empty space of the Reset row triggers the action; samples cleared afterwards (`reset`, `query` only) |
| Export through the real UI path | `power/samples.jsonl` (38 samples) and `power/aggregate.json` are in the archive; manifest `powerMetrics` lists sources and states `appEnergy: unavailable`, `batteryScope: device`; no content strings found in the samples |
| Monitor cost | Marginal CPU per sample median 2.2 ms, p90 5.3 ms, max 18 ms; 12 binder calls per sample; the `uc-power-metrics` thread used 20 ms by `/proc` vs 20.3 ms self-reported; about 0.4 % of the app's CPU in that process. Wall time per sample median 31 ms, p90 172 ms, max 387 ms in this run (transitions under load; it runs on its own thread) |
| Device-side failure modes (Kotlin instrumentation, 7 cases) | missing sensor, denied permission, impossible zero counter, rate limit, retention truncation, reset, closed schema: all pass |
| Aggregator failure modes (Jest, 15 cases) | clock jump, restart gap, reboot, counter reset, unavailable sensor, charging contamination, short window, stuck counter, dropped samples, reset marker, period filter, retention, service/Doze time, parser |

Order caveat: the Jest aggregator cases were written before the aggregator. The native recorder was written first and its
Kotlin cases and the UI regression test were added afterwards; the end-to-end run above is the primary evidence for those.

## Inferred or not measured

- **No physical-device run.** The emulator battery hardware is synthetic: level changes were driven by `dumpsys battery set`,
  the charge counter stays constant, and no energy counter exists. Therefore the battery numbers validate semantics (windows,
  charging exclusion, `suspect` status), not energy precision, and no power improvement is claimed.
- Wake-lock time: only the "no timer held" path (`null`) was exercised. A positive wake-lock duration was never produced, so
  its calibration against `batterystats` is missing.
- Sync activity with a fixed number and size of entries against a real peer was not run (no desktop `uniclip` CLI binary matching
  the pinned Engine was available). Engine event counts and relay traffic from an idle isolated space were observed instead.
- `HealthStats` CPU measurements are refreshed lazily by the OS (0 at the first sample, correct only after a `dumpsys`
  export). They are recorded for diagnosis and never aggregated; the aggregator uses `Process.getElapsedCpuTime`.
- Perfetto was not used. Independent evidence is `dumpsys batterystats`, `/proc` and the OS network stats.
- Heartbeat count and sync duration are not exposed by the pinned Engine and are reported as unavailable.
- `am kill` does not stop a process that holds a foreground service; crashes were injected with `am crash`.

## Real device (read-only only)

A real Xiaomi device was observed with read-only `dumpsys` commands only; nothing was installed or changed. See the read-only
excerpt under the project artifacts. The in-app recorder was not run there because the build shares the `.dev` application id
with the user's installed app.
