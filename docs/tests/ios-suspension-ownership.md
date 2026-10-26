# iOS suspension storage ownership

## Scope

The baseline is Mobile `fcf68bfe917fc7a12a3c0696ac90b5463ae0b724` with Engine
`f44ae136f76a05e642fc22e32b823161f0716cef`.
This change repairs Mobile ownership defects. It does not identify the file in
the original RUNNINGBOARD `0xdead10cc` reports. It does not change the Engine API
or release runtime ownership before Engine completion.

## Ownership

`AppGroupStore/StorageAccess` contains the Foundation admission owner.
The main bridge, Engine host and extension processes use one instance per
process. The Share dependency excludes Expo and Engine. The SwiftPM host uses
the same source through the `SharedStorageAccess` product.

The owner rejects new operations after background admission closes.
It counts an accepted operation until that operation returns.
Each foreground entry creates a generation. A queued writer must present its
original generation before it can access storage. A stale expiration cannot
close a new generation. Cleanup completion waits for operations from its own
or an earlier generation.

| Owner | Suspension behavior |
|---|---|
| JS history | Stop leases, retain the connection on close failure, retry its actual close, and reject a late open. |
| Native history | Close SQLite from `HistoryLog.suspend`; reopen lazily after `onAppear` resumes history. |
| Host acknowledgement | Complete only for the matching transition with `released=true`. Listener removal does not certify release. |
| Native storage | Retain the native-files background part until accepted calls return. |
| Native diagnostics | Reject new records and discard queued or completed records from old generations. |
| Payload cache | Fence deferred fetches and Share file copies at their actual disk entry. |
| Analytics | Deny queue writes while suspended and reject delivery acknowledgements from an earlier generation. |
| Share diagnostics | Fence the recorder generation and stop lock acquisition on suspension or its acquisition deadline. |
| Extension Engine | Retain the Engine and runtime flock after suspend and shutdown both fail. Retry existing cleanup APIs. |

Grant-end and host-acknowledgement reports use OSLog. They do not open an App
Group journal. Quiescing must complete suspend before Mobile reports success.
ShuttingDown alone does not certify suspension.

## Replays

1. Install the project's JavaScript dependencies if the JS replay is required.
2. Run `python3 e2e/ios-suspension/run.py --baseline` to preserve the baseline failure.
3. Run `python3 e2e/ios-suspension/run.py` to check extension storage sources.
4. Run `python3 e2e/ios-suspension/run.py --module-storage` to check the Expo storage sources.
5. Run `node e2e/ios-suspension/run-js.mjs --baseline` to preserve JS ownership failures.
6. Run `node e2e/ios-suspension/run-js.mjs` to check JS history and its suspension subscriber.
7. Run `python3 e2e/ios-suspension/check-builds.py` for nonvisual compilation and existing storage checks.

Use `--output-root <directory>` to retain artifacts outside the default
`e2e/results/ios-suspension` directory. Each run writes a new directory.
The native replay preserves compiler output, process exit codes, source hashes
and per-case assertions. It uses actual temporary SQLite data and independent
flock probes. The JS replay adapts the Expo bridge to real `node:sqlite` data.
Its injected close failure leaves the real connection open until retry.

The keyboard diagnostic fixture extracts the production `KeyboardDiagnostics`
class. It changes only the temporary log URL, constructor visibility and queue
barriers. It does not compile or run UIKit or the KeyboardModel UI.
The fixture receipt records these adaptations and the original source hash.
The analytics replay uses the existing SwiftPM binding compatibility types.
It intercepts a synthetic Foundation request with URLProtocol. It sends no
external telemetry. Callback and delivery-queue barriers preserve ordering.

## Acceptance limits

The keyboard.jsonl writer uses the same admission owner at both queue entries.
A queued record retains its original generation. The replay checks both entry
points and confirms that the current visible generation can write again.
This guard changes no synchronization task or transport behavior.

No replay launches an app, simulator, VM or device. No replay accesses a
production App Group, clipboard, profile, keychain or database.
A manual grant and controlled Engine are host mechanisms only.
No result certifies actual UIKit suspension or Rust Engine cleanup.
The full Expo/UIKit app build also requires the matching prepared Engine
binding and framework. An older cached binding is not a valid substitute.

## Device acceptance

Use an isolated bundle and App Group with synthetic data.
Match Mobile, Engine, dependency, executable and dSYM revisions.
Capture one transition id across background entry, grant expiration, owner
completion and descriptor/lock release. Repeat cold startup, accepted transfer,
keyboard dismissal, background and foreground sequences without a debugger.
Verify data preservation and exclusive runtime ownership after resume.
Keep watchdog, Jetsam, URLSession abort and blob panic results separate.

An accepted syscall or Engine cleanup can outlive a host deadline.
The Mobile owner must retain pending state in that case.
Engine must certify its operations, security leases, databases, blob actors,
redb handles and network-log release before complete acceptance.
Do not infer that certificate from a timeout or a controlled Engine substitute.
