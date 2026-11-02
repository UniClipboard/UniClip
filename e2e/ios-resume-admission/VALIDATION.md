# Recorded local validation

Task: `crash-199-native-resume-fix`.
Workflow: `crash-199-20261101`.

The implementation-stage validation used these source identities:

- UniClip base: `386e49f70877b2c82114e2784a8742ee6fb9583a`.
- Engine pin: `f3ffe490b30a82410400388a8dea10a76e71a82b`.
- Fixed source: the uncommitted implementation later included in this PR.

The host used arm64 macOS 27.0, Xcode 27.0 beta, SDK 27.0, Node 22.22.1 and Expo 57.
The dedicated iPhone 17 Pro simulator used iOS 26.3 and synthetic storage.
The local test binary is not the historical incident binary.

| Layer | Recorded result |
| --- | --- |
| Controlled native host | Baseline fails; fixed source passes 12 scenarios |
| Actual JS adapter with controlled ports | Baseline fails; fixed source passes four asynchronous boundaries |
| Real macOS Engine and encrypted SQLite | Baseline fails; fixed source passes, including actual runtime flock and history restoration |
| Full iOS application, case A | Baseline resumes after suspension; fixed source denies the stale bridge request |
| Full iOS application, case B | Baseline resumes after suspension; fixed source denies the request held inside the native operation queue |
| Full iOS application, case C | Baseline resumes during old flush and reports late closure; fixed source prevents both events |
| Full iOS application recovery | A and B each pass three background/foreground cycles; actual UIKit activity identifiers end once |
| Existing Swift tests | 78 pass |
| Existing JS tests | 20 pass |
| Compilation and static checks | Swift build, TypeScript, targeted ESLint and restored production iOS application build pass |
| Fixture bundle | Expo/Metro bundles the delivered CommonJS entry successfully |

Cases A and B sample zero Engine database descriptors after the denied request.
An independent Python process acquires the exact simulator `.runtime.lock` before and after that request.
The final verdict retains generic lock descriptor samples separately.
An earlier assertion on all generic lock descriptors failed because that category also includes diagnostic locks.
Those failed receipts remain in the local evidence.

No unit tests were added.
Failure modes and controlled failing scenarios preceded the production changes.
The full iOS baseline ran after implementation against unchanged Git-base native source.
The repaired application then ran the same scenarios.

## Evidence and limits

The local evidence remains under `.lody-artifacts/crash-199-fix/` in the implementation workspace.
The directory includes command exits, source snapshots, binary hashes, monotonic events,
machine-readable verdicts, actual UIKit task identifiers and an integrity manifest.
`verify-artifacts.py` checks those files and the restored production source.
The PR excludes the generated evidence directory and its test binaries.
Use [README.md](README.md) to reproduce the scenarios with fresh output directories.

Physical-device RunningBoard behavior and continuous syscall tracing were not run.
Forced startup overlap, quiesced recovery and dense transition bursts have controlled host coverage.
The simulator did not force all those branches or launch an extension process.
Descriptor samples and flock probes do not prove continuous absence of every file access.
The historical JS producer, enqueue time, OTA identity and terminating file lock remain unproven.
This change repairs the demonstrated admission gap; it does not prove the complete historical crash cause.
