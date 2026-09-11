# Mobile E2E framework validation

Date: 2026-09-11. Local Apple Silicon macOS. No physical-device or cross-device-sync acceptance.

## Tested artifacts

- Maestro 2.10.0; iOS 26.3 / iPhone 17 Pro; Android API 36 / Pixel 8 arm64.
- iOS: `app.uniclipboard.UniClipboard.dev`, version 2.0.0 (180), Release Simulator build with simulated App Group entitlements.
- iOS executable SHA-256: `6f20ec48bf61a3adc4700ac7f12ddb226aa58a178aae05d9b4be3aa721e63096`.
- iOS main.jsbundle SHA-256: `6805eaab2bc800cef7d0b6be66830cf8628502f4bfd0b0798a1a1758d6293336`.
- Android APK SHA-256: `148247273325af9bc6df6a01e566f4a1383aaf6df441940fa5eae8647f6d84d6`.

## Observed results

- iOS standalone first-launch: passed; `e2e/results/2026-09-11T03-34-13.380Z-ios-13762` (initial build; signed build is rechecked in the repeated suite).
- iOS standalone settings-navigation: passed with signed artifact; `e2e/results/2026-09-11T03-45-39.471Z-ios-26383`.
- Android combined first-launch and settings-navigation: both passed; `e2e/results/2026-09-11T03-44-16.672Z-android-25617`.
- iOS three-round suite: all 6 passed, with nonempty reports, screenshots, hierarchy and logs verified; `e2e/results/2026-09-11T03-47-52.940Z-ios-28635`.
- Android final three-round suite: all 6 passed; `e2e/results/2026-09-11T04-20-36.322Z-android-13017`. All six transport IDs are unique and within the recommended port range. Every report has one executed, unskipped test with no failure/error; screenshot, hierarchy and logs are nonempty. All owned devices and AVD directories were confirmed removed.
- Deliberately failing final assertion: verified; `e2e/results/2026-09-11T04-02-50.349Z-ios-57257`. Exit code 1, exactly one expected missing-label assertion, nonempty screenshot/hierarchy/log/report, owned Simulator absent afterwards, temporary scenario removed.

Screenshots from both passing settings runs were inspected: the 85%-across row tap lands in empty trailing space before the chevron. Each run ends on the actual home screen. The final home check also requires settings/storage controls to be absent.

## Integration findings resolved

- Android's live update dialog blocked navigation. Local-only scenarios disable Wi-Fi and enable airplane mode explicitly, in the device environment before Maestro starts. Merely disabling Wi-Fi/mobile data was insufficient on the fresh emulator. An early repeated run also detected an Android transport drop at launch; the final preparation waits for boot/provisioning and consecutive successful readiness observations after radio setup, without toggling radios again inside a flow or retrying failed business actions. Since a later trial still reported a drop at launch, emulator transport IDs are now also unique across the entire run rather than reusing the first free port. The final repeated suite validates the supported-range allocator and readiness checks together; earlier failed reports are retained.
- Under concurrent simulator/build load, Android restart took just over 30 seconds to finish opening its database. Readiness now waits for an observable screen up to 90 seconds, rather than sleeping or assuming a startup performance guarantee.
- An unsigned iOS Simulator build launched but could not access its App Group and showed a statistics-settings error. Rebuilt with ad-hoc signing. Preflight checks the actual embedded `__TEXT,__entitlements` section using otool/plutil; codesign's signing entitlement dictionary alone is empty for these simulator builds and is not the correct check.
- Maestro 2.10 requires takeScreenshot paths to stay within its own per-flow screenshot output. Flow screenshots use relative names; reports and diagnostics remain under the runner's isolated output directory.

An interrupted obsolete iOS run preserved the abort as failure and cleaned its device. Earlier failed Android runs retained screenshot, hierarchy, report and device log, then removed their owned AVD. Existing personal devices were not selected or erased.

## Other checks

- Environment/structure tests: 12 passed (flow graph, full-row flow, lifecycle failures, options, simulator entitlement decoding, unique emulator transport allocation and supported port-range limits).
- Focused affected UI tests and TypeScript checks passed.
- Focused lint: no errors; existing UI style/type warnings remain.
- Native Release builds completed on both platforms. The pre-existing generated Engine XCFramework did not match its pinned prepared marker; restored from the matching cached archive after verifying every recorded framework hash. No tracked Engine files changed; prior generated files were backed up at `/tmp/mobile-e2e-engine-before`.

The existing CI test workflow runs the portable framework checks. Actual simulator E2E execution is local in this first delivery; no hosted simulator workflow has been executed or claimed as passing.

A transport-isolation trial also exposed an invalid port-range assumption: the installed emulator explicitly recommends even console ports 5554–5584. The allocator now stays in 5556–5584, retains unique identities per run and rejects excessive repeat counts. One earlier out-of-range run could not capture a screenshot after disconnect; its capture error was preserved separately, not reported as complete evidence.

## Acceptance outcome

Local minimum accepted: both scenarios passed three consecutive rounds on both platforms (12 successful device runs), plus the explicit failure-evidence probe. All final successful runs have complete evidence and verified cleanup. This does not claim that hosted simulator CI, physical devices, cross-device sync or animation-frame validation passed.
