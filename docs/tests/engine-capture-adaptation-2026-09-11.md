# Mobile adaptation to Engine local diagnostics — 2026-09-11

## Scope

Mobile-only adaptation to Engine `b9b25fb22850733b6a732edce77917935fb01b40` (includes `9708c278`); no Engine source changes. Existing PostHog product capture and independent native journals remain. Share still has no Engine dependency.

- Both native bridges expose start/stop/query and bounded export preparation. Report fields are explicitly mapped rather than serialized from arbitrary errors.
- Archive collection first prepares the Engine report, then reads files. It includes actual build source, capture mode, filtered/schema/correlation counters, source coverage and source write counters. Counters retain the Engine's `typed_events_only` scope and are not presented as counts of all retained log lines. Older/unavailable native APIs preserve the previous flush-and-export fallback.
- Engine host registration is `partial`. Available runtime start/stop, recovery, lifecycle, ownership and default-network boundaries are forwarded. Initial/pre-install failures and Share records remain in independent native files. Main app does not claim another process was flushed or a cross-process trace was established.
- Existing native settings rows start a maximum ten-minute capture or stop the current capture. Status is read from Engine, including expiry and resume interruption. Leaving the page does not stop capture; returning re-queries state. Slow polling cannot swallow a user action or overwrite newer state.
- Capture is local to the Engine process. Starting it in the main app does not enable detailed capture in another extension. Nothing retroactively recovers filtered events.

## Validation

- Full Jest run: 188 suites / 1,335 tests passed. TypeScript and scoped ESLint passed. E2E environment checks: 16 passed.
- Freshly generated Swift binding plus the mobile report bridge passed Swift typechecking.
- A compiled Swift probe linked the actual new Engine host library. It verified installation, exact source revision, report mapping, real host event files, detailed capture expiry, stale-capture stop protection and foreground resume interruption. Evidence: `/tmp/mobile-capture-host/report.json`, `result.log`, `files/cache/logs/engine.2026-09-11.jsonl`. This is host-process proof, not device proof.
- Engine iOS universal and Android ARM64/x86_64 artifacts were built from the requested checkout revision. Pin hashes were populated from the actual prepared files; both prepared and local iOS integrity checks passed. Release iOS Simulator and Android application builds passed.
- iOS Maestro `diagnostic-capture` passed with a bundled Release app on a fresh owned simulator: `e2e/results/2026-09-11T06-51-36.778Z-ios-86988`. The UI exported a ZIP containing 26 Engine records from two process runs, the exact Engine source revision, completed flush, stopped capture and explicit other-process flush=false. Screenshot layout was reviewed from Maestro evidence.
- Android Maestro `diagnostic-capture` passed on a fresh owned emulator: `e2e/results/2026-09-11T07-13-06.368Z-android-9245`. It exercised full-row start, switch-thumb stop, page revisit, process restart and saving via the system Documents picker. The saved ZIP contains 26 Engine records from two runs, source `b9b25fb2`, completed flush and standard mode; recorded host version is `2.0.0-alpha.3`. Layout and the saved-file result were reviewed from Maestro screenshots.
- 22 Android instrumentation tests passed, including version normalization and real native file writing/rotation. Both final application builds passed; neither requires Metro for these scenarios.
- Each platform's new scenario passed independently once after fixes. These results are not a claim of rerunning the entire five-scenario suite for three rounds. The test environment disposed each owned device after evidence capture.

## Defects found by E2E

1. Fresh onboarding without a sync connection left process observability uninstalled, so the capture control stayed unavailable. Process logging now installs independently through existing native host storage setup; it does not start MobileEngine or networking. Native module startup schedules it off the UI thread, and capture/status/export retry initialization when needed. This allows recording before the first connection attempt.
2. Android display versions such as `2.0.0.179-alpha.3` are not valid Engine service versions. Native logging now uses `2.0.0-alpha.3`, preserving the original app display version/build elsewhere. Both early logging setup and later Engine startup use this normalization. A native regression covers release, prerelease, build metadata and invalid values.
3. Expo's Android Switch remains clickable even when the JavaScript callback is omitted. In the shorter active row, the trailing-space test point hit the Switch, which consumed the stop tap without forwarding it. The existing shared settings row now sends both row and thumb taps to the same guarded action. A rendered interaction test covers both paths and disabled state; the full E2E confirms stopping after page revisit. No library patch was needed.
4. Test selectors were corrected from Android About to Developer settings, and the iOS Share alert action is distinguished from the background Share icon using relative element selectors. Failed runs are preserved; no business-flow failures were automatically retried by the framework.

## Boundaries

These are local diagnostics integration checks, not physical-phone connection fault reproduction or peer synchronization proof. Engine counters remain process-scoped and typed-event-only; capture in the app does not enable an extension process. File inclusion and zero reported drops still do not establish complete cross-device coverage. The local-build pin remains for development, not a published Engine release.

## React Doctor follow-up

Ran `npm run doctor` across the workspace: 720 files, score 66/100, 5 errors and 190 warnings (exit 1). Output: `/tmp/mobile-react-doctor.log`. All five error locations are in files unchanged by this adaptation (WordPickerOverlay on both platforms, useOverlayGrowTransition, SettingsToastContext, and ShareSendController test). The new capture hook receives a loading-reset warning at line 44, but inspection confirms `setBusy(false)` is inside the `finally` block, guarded against updates after unmount; this appears to be a false positive. The archive reader's sequential-await warning points to the unchanged, bounded file-reading loop already present in HEAD. This scan is not a clean whole-project result, and no unrelated code was changed to raise its score.

### React Doctor warning resolved

The capture hook now uses one operation state (idle/pending/failed) rather than separate busy and failure flags. The final state is assigned in `finally`, retaining the unmount guard. The follow-up scan reports 194 issues (5 errors, 189 warnings); the capture-hook warning is gone. Existing whole-project findings remain. Eight focused tests passed, including rejection cleanup and completion after unmount; TypeScript, scoped ESLint and whitespace checks passed. This small state refactor was checked with the hook tests; the earlier native builds and E2E results above precede it. Output: `/tmp/mobile-react-doctor-after.log`.
