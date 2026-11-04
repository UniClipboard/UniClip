# Validation: issue 2217

Executed on macOS on 2026-11-04.

## Source and artifact identity

- Mobile base: `d9f8fb1d96800788d5c382e3263fb63a5afde4d6`.
- Engine release: `v1.1.0-rc.24`.
- Engine source: `203a9290eeb0df7eeef5b37d16cb74c824b7c47f`.
- The host library was built from that immutable Engine source with its pinned submodule.
- The generated Swift binding matches the release checksum: `688035d8101ca97a3a7f3e7873baba5fe9070bdb2723aa89496be2cb0cc58b93`.
- The running process logger reports the pinned source commit.
- Per-run receipts record source hashes, the binding hash, the library hash, commands, and exit codes.

## Results

| Check | Original source | Fixed source |
| --- | --- | --- |
| Logger holds a real network lease without an Engine or server | Yes | Yes |
| Network lease is free at each of three regular-mode background completions | No, all three probes find the lock held | Yes, all three probes find the lock free |
| Late native journal writes are rejected after background completion | No | Yes |
| Foreground return reacquires the network lease | Yes | Yes |
| Real Engine suspension and runtime-ownership release | Not part of the original regular-mode reproduction | Pass |
| Real Engine foreground recovery and encrypted-history restore | Not part of the original regular-mode reproduction | Pass |
| Pending or failed process release retains the background activity | Not run | Pass |
| Failed host database close retains the background activity | Not run | Pass |
| Final journal flush failure retains the background activity | Not run | Pass |
| Process observability resumes before Engine work | Not run | Pass |
| Failed process resume prevents Engine resume | Not run | Pass |
| Stale foreground work and queued startup logger installation cannot reopen files | Not run | Pass |

The original regular-mode replay exits 1 with a valid runtime reproduction. The final replay
exits 0 with all 29 checks passing. The separate lease-probe process uses the operating system's
nonblocking file lock. The synthetic background activity records the probe at its end boundary.

The existing `e2e/ios-resume-admission/run.py` host replay also passes. It preserves queued-resume
admission, foreground ordering, startup, repeated transitions, and extension ownership schedules.

The actual UcEngineCore sources compile as a module for the iOS simulator SDK. The production
NativeLifecycleHost and process lifecycle adapter also pass iOS simulator SDK type checking
against that module and the generated binding.

## Evidence location

Local evidence is under `.lody/artifacts/ios-background-crash-2026-11-04/`:

- `regular-red-3/result.json`: original source and the retained-lock failure.
- `final-green/result.json` and `receipt.json`: final checks and source/library hashes.
- `final-admission/result.json` and `commands.json`: existing host replay.
- `ios-typecheck/core.log` and `lifecycle-command.json`: iOS SDK compilation checks.
- `engine-host-build.log`: the source-matched macOS Engine library build.

These local artifacts are not application source or release artifacts.

## Acceptance limits

The host replay executes the real process logger, real Engine, native lifecycle sources,
generated UniFFI binding, encrypted storage, and operating-system file locks. UIKit background
activities are modeled. The harness uses a temporary directory, a synthetic clipboard, and
in-memory keys. It does not execute Expo module callbacks or RunningBoard.

Full application build: NOT RUN. iOS application E2E: NOT RUN. Physical-device acceptance:
NOT RUN. The device procedure in README.md remains required before claiming that the iPhone
termination is resolved in a distributed build.
