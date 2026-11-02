# iOS resume admission regression

## Failure modes (written before the fix)

1. A foreground JS refresh retains an active policy across its policy bridge await.
2. A resume already queued on the native operation queue executes after background suspension.
3. A resume acquires runtime ownership or accesses Engine files while admission is closed.
4. A foreground transition queued before a newer background transition reopens the Engine.
5. A background completion runs after an admitted foreground resume and reports old closure as current closure.
6. Startup overlaps background entry, including entry before a lifecycle object exists.
7. Foreground recovery from suspended or quiesced state is lost; repeated recovery duplicates work.
8. Rapid transitions deadlock or leave background activities outstanding.
9. A denied request reads lifecycle state or emits a foreground opportunity, causing background file access.
10. Extension runtime ownership is released or reacquired incorrectly.

## Required application E2E (not replaced by the host replay)

Use a dedicated test variant, a newly created simulator, and synthetic storage. Keep all
scheduling in the debugger/test runner. Do not add production bridge fields or hooks.

1. Build the pinned Engine, prepare Expo dependencies, and build the full iOS app.
2. Start the app and P2P. Record the binary UUID, source hashes, and monotonic events.
3. Hold an actual JS refresh immediately after `setBackgroundSyncPolicy` returns.
4. Use UIKit to background the app. Wait for native suspend and runtime ownership release.
5. Release the old JS continuation. Assert no Engine resume, ownership acquisition, lifecycle
   state query, or Engine file reopen before a real foreground event.
6. Repeat while the real exported `resume` closure is queued on `engineOperationQueue`.
   Hold the queue from the debugger, background and suspend, then release it.
7. Hold observability flush after suspend. Foreground the app and release a queued bridge
   resume. Assert background completion precedes the new resume. Record the actual
   `UIApplication.endBackgroundTask` call separately from its scheduling.
8. Repeat startup, delayed startup, quiesced recovery, rapid background/foreground/background,
   and extension handoff. Assert the latest foreground recovers and each activity ends once.
9. Save sanitized correlated events, actual UIKit task identifiers, command logs, machine-readable
   verdicts and hashes. Verify actual file access and OS lock evidence on a physical device.

The host replay below compiles the real lifecycle coordinator and runtime ownership classes.
It uses controlled Engine receipts, a real file lock, and test-side queue gates. It does not
run Expo, JavaScriptCore/Hermes, UIKit, SQLite, Engine, or RunningBoard. A host pass cannot
satisfy application E2E acceptance or prove the historical crash cause.

```sh
python3 e2e/ios-resume-admission/run.py --output .lody-artifacts/crash-199-fix/host
```

For a source-identical baseline comparison, run the same native scenarios against Git
objects without switching the working tree:

```sh
python3 e2e/ios-resume-admission/run.py --revision HEAD --output .lody-artifacts/crash-199-fix/base
node e2e/ios-resume-admission/run-js.cjs .lody-artifacts/crash-199-fix/js
```

The JS replay transpiles the actual adapter with the installed TypeScript compiler. It
controls its ports at startup, policy, resume, and projection boundaries. Those ports
are test doubles. It does not send an actual Expo bridge request. The native replay
holds an operation queue before calling the actual lifecycle host; that queue models
the Expo operation queue and does not invoke the exported Expo closure.

## Real Engine host layer

```sh
python3 e2e/ios-resume-admission/run-real.py --target-dir <this-workspace-prepared-host-target> --revision HEAD --output .lody-artifacts/crash-199-fix/real-baseline
python3 e2e/ios-resume-admission/run-real.py --target-dir <this-workspace-prepared-host-target> --output .lody-artifacts/crash-199-fix/real-final
```

Use only this workspace's Engine build target. The runner reuses `IsolatedHost` from
`e2e/engine-settings/main.swift`. It starts the real pinned Engine, creates synthetic
encrypted history, suspends it, releases a previously queued native host request,
checks the actual runtime flock, recovers in foreground, and restores the history.
It records source/library hashes and per-command exits. The bridge queue and background
activity remain models. No OS keychain or system clipboard is used. The in-memory
synthetic key owner is process-local; each output directory must be fresh.

The baseline should exit 1 with `queuedResumeDeniedWithoutStateRead=false` and
`actualRuntimeFlockReleased=false`. The fixed source should exit 0 with all checks true.
A compiler failure or startup error is an invalid reproduction, not the expected red.

## Real iOS simulator layer

Use macOS, the prepared Engine pin, a test-variant Debug app, and a newly created simulator.
Do not pass a personal or shared simulator to this runner. Run `core:prepare` before the
final `pod install`, so CocoaPods includes the generated Swift binding in its source glob.
Use Xcode's standard local simulator signing. Do not manually add device entitlements to
the simulator code signature. Expo 57 reference: https://docs.expo.dev/versions/v57.0.0/.

The fixture temporarily selects a CommonJS test entry and injects queue gates and event
recording into copies of the native source in the isolated workspace. It adds no bridge
fields. `prepare-ios.py` snapshots the original bytes, checks for intervening edits, emits
instrumented source manifests, and restores the exact original files. Always restore the
sources after testing, including after a failed build or interrupted run.

```sh
APP_VARIANT=test EXPO_NO_DOTENV=1 npx expo start --dev-client --port 8099
```

In another terminal, prepare and build one source mode. Use a fresh state directory for
an independent run. Baseline mode defaults to the recorded task base, not a later HEAD.

```sh
python3 e2e/ios-resume-admission/prepare-ios.py --mode baseline --state .lody-artifacts/crash-199-fix/rerun-state
APP_VARIANT=test xcodebuild -workspace ios/UniClipTest.xcworkspace -scheme UniClipTest -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath .lody-artifacts/crash-199-fix/rerun-derived ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM= build
python3 e2e/ios-resume-admission/run-ios.py --device <owned-simulator-id> --app .lody-artifacts/crash-199-fix/rerun-derived/Build/Products/Debug-iphonesimulator/UniClipTest.app --output .lody-artifacts/crash-199-fix/rerun-base-A --case A
```

Repeat the runner with cases B and C and separate output directories. Baseline commands
must exit 1 with the lifecycle failure below. A compiler or startup error is an invalid
reproduction. Do not discard those errors under a blanket success handler.

Prepare `--mode fixed` with the same state directory. Build again. Repeat cases A, B and
C. All fixed commands must exit 0. Stop the test app and Metro, then restore production
source and build it again without the fixture:

```sh
python3 e2e/ios-resume-admission/prepare-ios.py --mode restore --state .lody-artifacts/crash-199-fix/rerun-state
```

- A: background through Safari/UIKit, wait for actual Engine suspend and ownership
  release, then release a held JS continuation that calls the real exported resume.
- B: issue the real JS bridge request while active; hold it inside the native operation
  queue before the production admission check; background and suspend, then release it.
- C: hold the old observability flush after suspension; foreground the app; release a
  queued bridge resume; verify it cannot overtake flush or cause a late closure report.
- A and B also run three real background/foreground cycles and observe actual
  `UIApplication.endBackgroundTask` calls and task identifiers. The host replay covers
  a denser queued transition burst and quiesced/startup state branches.

The app process, Expo bridge, UIKit notifications, Engine and SQLite are real. The entry
and native timing gates are test-only. The entry calls the exported resume directly to
preserve the stale request even when the repaired JS adapter would discard it. This does
not identify the historical JS producer. Native source instrumentation emits monotonic
request/admission events and file-descriptor samples. An independent host Python process
probes the actual simulator `.runtime.lock` with nonblocking flock. Generic `.lock` counts
also include diagnostic locks; they must not substitute for that runtime-ownership probe.
Descriptor samples are not continuous syscall tracing or a permanent absence-of-lock proof.

The executed entry was initially named `native-entry.js`. The delivered entry uses the
repository's existing `.cjs` convention for CommonJS E2E fixtures. Its bytes are identical.
Metro's resolver includes `cjs`, and the delivered entry is separately bundle-checked.
