# Android power metrics: acceptance record

Contract: `docs/specs/006-android-power-metrics.md`. Rerun: `node e2e/power/run.mjs --apk <debuggable release apk> --serial emulator-<port> --out <dir>`
(owned, disposable emulator only; it changes battery/Doze/network state and reboots). Build the APK as in `e2e/README.md`, then set
`debuggable true` on the generated `android/app/build.gradle` release type so `adb run-as` can read the app's own sample file.

## Identity of the recorded run

- Source: branch `hp/uni/t-0193-android` on top of `0678dfbb`; the run's `environment.json` records the exact commit and dirty files.
- Engine pin: `v1.1.0-rc.22`, source `18415aa83a47bd3870c2a1f114b268fc3ed0495a`, AAR from the release manifest (`modules/uc-engine/core-source.json`).
- Device: Android 16 (SDK 36) arm64 emulator `sdk_gphone64_arm64`, AVD `uc-power-e2e-0193`, created for this run.
- Phases: 120 s per phase; calibration window about 121 s. The runner exits non-zero and writes `failures.json` when a UI, archive, calibration or malformed-sample check fails; the recorded run has an empty list.

## Measured (emulator, real app, real Engine with an isolated disposable space)

| Check | Result |
| --- | --- |
| Samples recorded at real boundaries (process start, foreground/background, screen on/off, plug/unplug, Doze, service start, Engine start, network change, query, reset) | 40 samples, 0 malformed, 0 dropped, 0 write failures |
| CPU calibration over a 121.1 s screen-off window | App record 3329 ms; `dumpsys batterystats` UID delta 3325 ms (0.1 %); `/proc/<pid>/stat` delta 3300 ms |
| Network calibration over the same window | Recorded rx 412 235 B / tx 233 504 B; OS stats (`batterystats` nt line, wifi+mobile) rx 410 651 B / tx 233 504 B (+0.4 % / 0 %; edge timing of two exports) |
| Process crash, force-stop, reboot | `prevExit` reasons `crash`, `userRequested`, `noExitRecord`; gaps reported as uncovered, never zero-filled; process counters not differenced across processes |
| Doze, charging, offline/online | Doze time and charging windows attributed; charging windows excluded from discharge numbers |
| UI | Power section renders on the diagnostics page; trailing empty space of the Reset row triggers the action; samples cleared afterwards (`reset`, `query` only) |
| Export through the real UI path | `power/samples.jsonl` (all samples) and `power/aggregate.json` are in the archive; manifest `powerMetrics` lists sources and states `appEnergy: unavailable`, `batteryScope: device`; no content strings found in the samples |
| Monitor cost | Marginal CPU per sample median 3.0 ms, p90 18.8 ms, max 23 ms; 12 binder calls per sample; the `uc-power-metrics` thread used 20 ms by `/proc` vs 28 ms self-reported (10 ms tick resolution; different process lifetime windows); about 0.4 % of the app's CPU in that process. Wall time per sample median 40 ms, p90 159 ms, max 232 ms in this run (transitions under load; it runs on its own thread) |
| Device-side failure modes (Kotlin instrumentation, 9 cases) | missing sensor, denied permission, impossible zero counter, rate limit, retention truncation, clock-forward cutoff, reset, undeletable file, closed schema: all pass |
| Aggregator failure modes (Jest, 16 cases) | clock jump, unknown plug state, restart gap, reboot, counter reset, unavailable sensor, charging contamination, short window, stuck counter, dropped samples, reset marker, period filter, retention, service/Doze time, parser |

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
