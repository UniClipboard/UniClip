# Mobile native runtime diagnostics — 2026-09-11

## Scope and contract

The user confirmed mobile-only implementation. Engine collection policy, detailed connection/discovery records, peer association and storage error-chain changes remain owned by the Engine team. No Rust source or binding contract was changed.

The existing process flush/health bridge is preserved. The mobile client now adds:

- A shared Swift journal for the main app, Keyboard and Share processes, and an equivalent Android journal. Share compiles the pure journal through a symlink; it does not acquire an Engine dependency.
- A closed event and field vocabulary covering capture startup, app foreground/background, Engine start/suspend/resume/shutdown, security recovery, runtime ownership, default network observations and extension visibility/handoff.
- UTC timestamps, monotonic timings, process/capture-session identifiers, native operation identifiers, and a native start-attempt counter. The attempt counter is explicitly not an Engine-owned runtime generation.
- Fixed failure reasons, numeric Engine/system codes and retry flags. No raw exception descriptions, clipboard contents, filenames, paths, invitations, credentials or network addresses are accepted by the new journal API.
- Bounded pending writes, 256 KiB files, a 24-file / three-day retention policy, and bounded cross-process file locking. iOS files use owner-only permissions and protection compatible with logging after the first device unlock. Rotation failures and dropped writes are surfaced rather than disrupting runtime actions.
- Export-time app/Engine/native flushing. App records keep their emission timestamp when flushed out of the idle queue; their new text timestamps are UTC. Existing PostHog capture remains outside the local scheduler and is unchanged.

## Export semantics

`logs/native/` contains the new structured files. The manifest describes per-source retained record counts, time ranges, session counts, malformed/unreadable/skipped files, writer state and bounded retention. Flush and live-writer counters are explicitly scoped to the exporting process/current capture session. They do not attest to another process's current buffer.

Engine capture policy, effective level, filtered-event count, process correlation and exact native source revision are **not reported by the current Engine API**. These fields remain unknown. The settings-page log level is not advertised as controlling Engine capture. `coverage.complete` remains false.

Missing or unreadable Engine files still produce `engine_logs_missing` / `engine_logs_unreadable` issue codes, but do not prevent exporting independent evidence. Native or Share collection failure likewise does not discard other sources.

Unreviewed Android `kotlin_*.txt` files are preserved on disk but excluded from this shareable archive. The old Keyboard debug file and OSLog/Logcat are not collected. These exclusions are explicit; the new journal is not described as a complete system-log dump.

## Validation

- 97 related Jest tests passed, including archive contents, incomplete/unavailable sources, queued app writes, privacy exclusions and native wiring.
- 16 focused Swift journal/ownership/extension-lifecycle tests passed.
- 2 Android instrumented journal tests passed on `emulator-5554`; they exercise real files, rotation and file-URI export.
- TypeScript, scoped ESLint and whitespace checks passed.
- Full iOS simulator and Android Debug application builds passed against the prepared local Engine (`28816139`). The requested Engine's iOS universal and Android ARM64/x86_64 artifacts were prepared successfully.

### Actual exported archives

Temporary simulator-only entry code called the same archive implementation with live settings and store snapshots. It was removed afterward, and `index.ts` was restored exactly. Real phones were excluded.

- iOS: the exported archive contained structured native capture/network observations. Native files passed fixed-field/no-raw-path checks; manifest policy and coverage flags were checked.
- Android startup: 16 retained native records included foreground, Engine start, security recovery and network observations.
- Android background/network/foreground: 24 retained native records included background, suspend, resume and default-path observations. Wi-Fi was restored to its original setting. This was an injected emulator network transition, not the reported physical-phone incident.
- An initial Android archive exposed a real integration defect: absolute paths were not readable by Expo's Android file API. Native export now returns `file://` URIs, an instrumented regression check covers the URI contract, and re-export succeeded.

Evidence summaries: `/tmp/mobile-native-ios-startup-proof.json`, `/tmp/mobile-native-android-startup-proof.json`, `/tmp/mobile-native-android-foreground-proof.json`. Earlier Engine-flush and authentication evidence is documented separately in `engine-log-flush-2026-09-10.md`.

## Remaining acceptance boundaries

- After the host was unlocked, actual simulator interaction selected the UniClip keyboard in Safari and dismissed it. The final ZIP contains six keyboard records, including `extension.visible` and `extension.hidden`. The keyboard displayed its existing missing-LAN-configuration error; this proves lifecycle capture, not successful keyboard synchronization or a new detailed Engine error record.
- A harmless local text fixture was shared through the real iOS share sheet by selecting UniClip Dev. The extension returned to the host. The final ZIP contains Share capture startup and a matching `share.handoff` started/succeeded pair (589 ms), written before completion. No peer send was requested.
- The final ZIP contains 23 native records across main (14), keyboard (6) and share (3), including three main-app capture sessions across restarts. All five native files were included, with zero unreadable, truncated or malformed files. Archive checks verified closed fields, paired Share operation identifiers and honest process-scoped flush states. Evidence: `/tmp/mobile-native-ios-extensions-proof.json` and `/tmp/mobile-native-ios-extensions-validated.zip`.
- The simulator-only fixture/export entry was removed and `index.ts` restored exactly. These are simulator extension lifecycle/export checks, not physical-device extension synchronization proof.
- No real-phone failure/recovery reproduction aligned with desktop logs was performed in this implementation. The reported connection root cause remains unknown.
- The full diagnostic-chain goal still depends on Engine-owned policy, detailed connection context and reviewed storage failure details. File inclusion and zero reported writer drops do not establish that coverage.

## Pre-commit verification

On 2026-09-11 the full Jest run passed: 183 suites / 1,319 tests. TypeScript passed. Native sources are unchanged since the successful simulator builds, focused native tests and actual extension archive validation above.
