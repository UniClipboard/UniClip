# Mobile outbound progress adoption

## Source identity

The development pin is Engine `80bda137541f1a054897f8d1474634dac9d752e8`.
The nested network source is `413531dd7503c87ce89f21b69196f8c26eed909d`.
The package version remains `v1.1.0-rc.23`. The version does not identify the source.

The existing source build generated Swift, Kotlin, the universal iOS XCFramework
and the Android arm64 AAR from this source pair. The prepared marker records each
artifact hash. The AAR contains the generated classes and the native arm64 library.
This build is not a published Engine release.

## Product behavior

Engine owns progress, reconciliation, authorization, admission and transfer retries.
Mobile retains complete snapshots in memory. Mobile does not persist remote terminal facts.
Each snapshot keeps the entry, target, attempt, revision, freshness and item results.
New u64 progress fields use decimal strings. Optional fields retain null values.

`outboundProgressChanged` invalidates the projection. The event does not establish delivery.
Startup, foreground recovery, reconnect and refresh requests read the complete list.
A failed read retains old facts and marks the projection unavailable.
A runtime reset rejects a late read from the previous runtime.

The existing transfer results sheet shows each target and each item.
The Share sheet reuses the same section during sending.
The result view distinguishes processing, retries, partial results and unconfirmed results.
Header acceptance and completed bytes do not establish file completion.
Delivery waiters use the selected target set. An unrelated target cannot satisfy a recipient count.
A local wait deadline leaves the result pending. The deadline does not fail Engine work.
Dispatch counters retain their original meaning.

Resend checks existing work by default. The native bridge receives `confirmNewTransfer=false`.
The result retains each target's classification, complete current view and new-transfer flags.
Only Settled, NotRetained and Unsupported offer a new-transfer request.
A second button confirms that request after a duplicate-file warning.
Engine checks final admission again. Confirmation cannot bypass Running, Superseded,
Busy, Unreachable, authorization errors or storage errors.

A repeated Share send within one live session checks its existing Engine entry.
The session mapping is not persisted. Queue claiming, expiration and close behavior remain unchanged.
The interrupted-Share policy remains outside this change.

## Ownership boundary

Android retains the actual Engine and file registry while final cleanup is Pending or Failed.
Only Pending repeats waits with backoff. Failed stops automatic waits.
Released(error) permits instance destruction and preserves the operation error.
Service release, runtime detach and activity transitions dispatch off the main thread.
Suspension waits use the same instance. Foreground recovery waits for accepted suspension to settle.
A failed start that returns no Engine retains its startup owner. This SDK has no complete receipt for that case.

The iOS changes cover actions, mappings and the keyboard progress waiter.
This branch does not merge PR96 or replace its NativeReleaseOwner.
PR96 integration still requires its authorized baseline and the upstream process-observability
and failed-start contracts. Engine Released does not acknowledge independent host files.

## Repeat the authorized checks

Use only temporary profiles. Do not run the device harness for these checks.

1. Install the existing dependencies with `npm ci --ignore-scripts`.
2. Build the fixed SDK with `UC_ENGINE_REPOSITORY=<clean-engine-clone> npm run core:prepare`.
3. Verify the artifacts with `npm run core:verify`.
4. Run `npm run check:quality`.
5. Run the product projection replay with `node e2e/outbound-progress/run.cjs`.
6. Run the TS module replay with `node e2e/outbound-progress/run-module.cjs`.
7. Run the React result flow with `node e2e/outbound-progress/run-ui.cjs`.
8. Run the Share session flow with `node e2e/outbound-progress/run-share.cjs`.
9. Run `python3 e2e/outbound-progress/run-native.py --target-dir <source-build-target> --output <evidence>/swift`.
10. Run `python3 e2e/outbound-progress/run-kotlin.py --output <evidence>/kotlin`.
11. Run `python3 e2e/outbound-progress/run-owner.py --output <evidence>/owner`.

The Swift runner requires the matching macOS host library from the SDK source build.
The Kotlin runners use the generated classes from the prepared AAR.
The owner runner copies the actual final-owner methods and renames the Context type.
Its Engine receipts are controlled. Its file-lock probes use independent JVM processes.
This replay does not run the Android framework or the suspension scheduler.

To compile the native product, generate native projects with Expo prebuild.
Run `:uc-engine:compileDebugKotlin` and `:foreground-service:compileDebugKotlin` with Gradle.
Compile the iOS workspace for a generic simulator destination without signing.
Do not install or launch the result as part of this workflow.

## Evidence and remaining acceptance

| Evidence | Result | Scope |
| --- | --- | --- |
| Exact SDK source build and prepared verification | PASS | Swift/Kotlin and matching release native libraries |
| TS quality | PASS | TypeScript and lint; existing warnings remain |
| Projection/coordinator flow | PASS | 7 controlled native-boundary scenarios |
| TS module error and intent flow | PASS | Actual exports and controlled native envelopes |
| React result and confirmation flow | PASS | Actual component and stores; controlled native rendering |
| Share repeated-send flow | PASS | Actual hook; controlled sync/native boundaries |
| Swift bridge matrix | PASS | All batch, item and reconciliation states; exact u64 and null |
| Swift isolated Engine actions | PASS | Temporary macOS host; no remote transfer |
| Kotlin bridge matrix | PASS | Generated AAR records and actual copied mapper methods on JVM |
| Android final-owner replay | PASS | Controlled receipts and independent real temporary file locks |
| Android module and foreground service compilation | PASS | Matching generated Kotlin/AAR; no device |
| iOS App and extensions compilation | PASS | Unsigned Debug simulator build; no launch |
| Android suspension scheduler runtime | NOT RUN | Native compilation only |
| Real App progress and confirmation | NOT RUN | Requires user visual acceptance |
| Real lifecycle and cross-device transfer | NOT RUN | Requires separate authorization |
| PR96 and upstream release-contract integration | WAITING | Requires an authorized integration baseline |

The first SDK-source CI inspection found multiple cancelled jobs. Cancelled jobs are not passes.
The first full iOS build saw mixed source timestamps during active editing.
The final build recompiled the changed Core and keyboard sources together and passed.
Early isolated-host fixtures used invalid or unauthorized input assumptions.
The final replay preserves typed errors instead of treating those errors as absent progress.

No new unit tests were added. These checks do not certify physical-device behavior,
the original iOS suspension crash, full blob-descriptor closure or production release readiness.

## User acceptance checklist

Use an isolated test profile after authorization.

1. Send two files to two devices. Confirm that each target keeps its own item results.
2. Observe waiting, processing and retrying. Confirm that unknown bytes remain unknown.
3. Disconnect one device. Confirm that Mobile shows an unconfirmed result without a permanent animation.
4. Reconnect and resume Mobile. Confirm that the complete snapshot replaces the old view.
5. Check an existing transfer. Confirm that the check does not create another download.
6. Request a new eligible transfer. Confirm that the duplicate-file warning appears before confirmation.
7. Check Running, Superseded, Busy and offline targets. Confirm that no confirmation bypasses Engine admission.
8. Restart Mobile. Confirm that Mobile uses Engine evidence and does not restore an invented terminal result.
9. Exercise App/Share/keyboard handoff and Android service/JS teardown after the owner integration gates are resolved.
10. Record new/new and fixed-old peers across Direct and Relay paths, including large images and supported files.

Record unsupported folders, empty directories, network changes and device-only scenarios separately.
Keep each unexecuted scenario marked NOT RUN.
