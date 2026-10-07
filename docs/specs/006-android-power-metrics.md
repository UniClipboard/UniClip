# Android power metrics: contract and failure modes

Status: implemented on Android only. iOS is out of scope.

## Purpose

Users report high power use when background sync is enabled on Android. This
feature records, locally and with bounded retention, what the device and this app
were doing while the user used the phone, so that a power complaint can be
explained with facts instead of guesses.

It is an **observation and attribution** feature. It does not change sync
reliability, the foreground-service policy, or any background behavior.

## Non-goals and hard limits

- **Android exposes no public, unprivileged API for per-app energy.** `BatteryStats`
  usage (`BatteryStatsManager#getBatteryUsageStats`) and the "battery usage" screen
  data require the privileged `BATTERY_STATS` permission. We must not use root,
  shell elevation, or `adb` from inside the app. Therefore the app never reports
  "this app used X mAh". `appEnergy` is **always unavailable**.
- Whole-device battery change is **not** this app's consumption. The UI and the export
  label it as device-wide.
- `BATTERY_PROPERTY_CURRENT_NOW` is an instantaneous reading with an OEM-defined sign
  and unit quirks. It is stored raw for diagnosis and **never integrated** into energy.
- No remote telemetry. Nothing here is sent to PostHog or any server. Samples never
  contain clipboard content, keys, tokens, device names, peer ids, or space ids.

## Scopes

Every metric names exactly one scope. Scopes are never added together.

| Scope | Meaning | Metrics |
| --- | --- | --- |
| `device` | Whole phone | battery level, charge counter, energy counter, current, screen, plugged, Doze, power-save, standby bucket |
| `process` | This app's single process (JS, UI, Engine native threads all live in it) | `Process.getElapsedCpuTime()` |
| `uid` | This app's Linux UID | `TrafficStats` rx/tx bytes, `HealthStats` wake-lock time / CPU time / radio time |
| `engine` | Engine events observed by the host | counts of `nextEvent` types |

The app has exactly one process (no `android:process` component), so `process` and
`uid` CPU describe the same work; they are two sources for cross-checking, not two
quantities. CPU is reported from the `process` counter as the primary value and
the `uid` `HealthStats` CPU time is a cross-check that is never summed with it.
Network bytes: `TrafficStats` is the primary value; `HealthStats` does not provide an
independent byte total, so there is no double counting.

## Sample (raw record)

One JSON object per line in `files/power-metrics/samples.jsonl`. Counters are
cumulative as the OS reports them; deltas are computed later, only between two
samples that share a reset epoch.

```
v            schema version (1)
seq          monotonically increasing within the file
reason       closed vocabulary, see "Sampling points"
wallMs       System.currentTimeMillis (display only; may jump)
elapsedMs    SystemClock.elapsedRealtime (includes deep sleep; duration base)
uptimeMs     SystemClock.uptimeMillis (excludes deep sleep)
epoch        { boot, procStartElapsedMs, pid }  reset epoch for counters
ctx          { app, importance, screen, plugged, doze, powerSave, service,
               engine, net, bucket, bgRestricted }
dev          { levelPct, chargeUah, energyNwh, currentNowUa, currentAvgUa }
app          { cpuMs, rxBytes, txBytes, health }
cnt          { engineEvents: {type: n}, droppedSamples }
self         { samples, costUs, cpuUs, binderCalls }  monitor's own cost
```

`null` always means **unavailable**. A missing source is never written as `0`.
Units: ms, µAh, nWh, µA, bytes, percent.

`ctx.app` is `fg` or `bg` from activity lifecycle callbacks, cross-checked against
`ActivityManager.getMyMemoryState().importance` (kept raw in `ctx.importance`).
`ctx.service` is "foreground service running". `ctx.engine` is "Engine started and
not shut down".

## Sampling points (no timers, no polling, no wake lock)

Samples are taken only at boundaries that already exist, each costing a handful of
cheap reads on a background thread:

`process.start`, `app.foreground`, `app.background`, `screen.on`, `screen.off`,
`power.connected`, `power.disconnected`, `doze.changed`, `powersave.changed`,
`service.started`, `service.stopped`, `engine.start`, `engine.suspend`,
`engine.resume`, `engine.shutdown`, `network.changed`, `query` (user opens the
overview or exports), `reset`.

`ACTION_BATTERY_CHANGED` is never registered as a receiver (too frequent); the sticky
intent is read at boundaries instead. Bursts are limited by a token bucket
(30 samples per minute); excess samples are dropped and counted in
`cnt.droppedSamples`, so a flapping network cannot inflate cost.

## Windows and aggregation

A **window** is the interval between two consecutive samples. Its context is the
context recorded at the window's start sample. Aggregation is a pure function over
samples (`src/support/power/aggregatePowerSamples.ts`), shared by the UI and the
export, so the two cannot disagree.

Totals are bucketed by `app (fg|bg) × screen (on|off) × charging (yes|no)`.

### Failure modes and their semantics

| Situation | Detection | Semantics |
| --- | --- | --- |
| Clock set back / forward | `abs(Δwall − Δelapsed) > 2 s` | Durations use `elapsedMs`. Window flagged `clockAdjusted`; wall time is never used for durations. |
| Process restart (crash, kill) | `epoch.procStartElapsedMs` or `pid` differs | `process` counters (`cpuMs`, `cnt`, `self`) are not differenced across epochs. The window between the last old sample and `process.start` is a **gap**: duration is reported as `uncovered`, with no app/ctx attribution. |
| System killed the process | `ApplicationExitInfo` (API 30+) read at `process.start` | Previous exit reason stored on the `process.start` sample as `prevExit` (reason name, importance, timestamp). Below API 30 the reason is `unavailable`. The gap is still `uncovered`; it is never filled with zeros. |
| Reboot | `epoch.boot` differs | Device and uid counters reset; no deltas across boots. |
| Counter went backwards | negative delta | Window flagged `counterReset`; that counter is excluded for the window, others unaffected. |
| Doze / App Standby | `ctx.doze`, `ctx.bucket`, `ctx.powerSave` | Recorded as context only; reported in the overview. Standby bucket and background restriction are shown because they explain missing background activity. |
| No current / charge sensor | `Long.MIN_VALUE`, `0` for a counter that cannot be zero, `-1` bytes | Field is `null` (unavailable). Aggregate says `unavailable`, never `0`. |
| Sensor present but stuck | Charge counter unchanged while level changed by ≥ 2 % over discharging windows | Device charge delta marked `suspect`; the percent change is shown instead, with its 1 % resolution caveat. |
| Permission denied / `SecurityException` | caught per source | That source is `null` and listed in `sources` as `denied`. |
| Charging contamination | `plugged != none` at either end of a window, or a plug change inside it (every plug change is a sample) | Window is `charging`. Its battery change is excluded from discharge totals and rates. App activity (CPU, network) still counts, in the charging bucket. |
| Short window / coarse level | Discharge coverage under 10 min, or level change under 1 pp with no usable charge counter | Rate is `insufficient`, not `0`. |
| Samples dropped by the rate limit | `cnt.droppedSamples` increased | Window flagged `coalesced`; totals stay correct (counters are cumulative) but attribution at the dropped boundary is lost. |
| Retention | file cap 1 500 samples, 7 days | Oldest samples are dropped on compaction; the aggregate reports `retention.truncated`. |
| Write failure / partial last line | JSON parse fails | Counted as `malformed`; the rest still aggregates. |
| User clears statistics | `reset` | File is replaced by one `reset` sample so no window spans the reset. Diagnostic logs are untouched. |

Percent and charge-counter deltas are **device-wide**, always. Sections that show
them are titled accordingly.

## What is reported

Per period (default: last 24 hours) and per bucket:

- elapsed duration (covered), `uncovered` duration, window count
- process CPU time, uid wake-lock time, UID network rx/tx bytes
- foreground-service running time
- Engine event counts by type (what `nextEvent` exposes; connection recovery and
  incoming/outgoing entry events). Heartbeat and per-sync duration are **not exposed
  by the pinned Engine and are reported as unavailable**.
- device battery change (level / charge counter / energy counter) over discharging
  coverage only, with `valid`, `suspect`, or `unavailable` status
- the monitor's own cost (`self`)

## Overhead budget

No timer, no thread beyond one daemon writer, no wake lock, no network. Each sample
is at most two `BatteryManager` property reads per field, one `takeMyUidSnapshot`
binder call, one standby-bucket call, one file append. Measured cost is recorded in
`self` and reported in the acceptance artifacts.

## Calibration sources (acceptance only, never used by the app)

`adb shell dumpsys batterystats` / `--checkin` for uid CPU, wake locks, network, and
Perfetto for scheduling and wakelocks. An emulator has synthetic battery hardware: it
validates semantics (windows, resets, unavailable handling), not precision.
