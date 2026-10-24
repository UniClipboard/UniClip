# Engine settings adoption E2E

This command-line host executes the generated Swift UniFFI interface. The macOS
mode uses the real host dylib. The iOS simulator mode links the prepared iOS archive. It uses real Engine settings I/O, a synthetic in-memory secure
store, an in-memory synthetic clipboard, and no production profile or device. It is not an iOS
or Android application acceptance test.

## Failure modes recorded before implementation

- A stale binding or binary can disagree with the pinned source.
- Removed product settings, including invalid legacy enum values, can prevent startup.
- Saving settings can reset the device name, relays, or other Engine settings.
- Restarting Engine can lose a successful write.
- A missing host log-profile declaration can be misrepresented as production.
- A validation host can accidentally read the system clipboard or keychain.
- A simulator can fail to boot, reject a binary, or remain after failed cleanup.

## Reproduce

Use Node 22, Python 3.11 or later, macOS, Xcode, and the repository's existing Rust build tools.
Do not use a local-source override for the product pin.

1. Fetch the exact `modules/uc-engine/core-source.json` commit in an Engine checkout.
   Keep the previous Mobile pin from origin/main in that checkout too. The runner
   records the source diff, so a shallow checkout must fetch both commits.
2. Run the existing preparation pipeline:

   ```sh
   UC_ENGINE_REPOSITORY=/absolute/Engine \
     UC_ENGINE_LOCAL_TARGET_DIR=/Volumes/ExternalSSD/cargo-targets/verification/mobile-engine-output \
     npm run core:prepare
   npm run core:verify
   ```

3. Use an explicit, task-owned output directory on the external build disk. This
   retains the host dylib; the default storage wrapper deletes its temporary output.
   Pass that directory and the Engine checkout to the E2E entry point:

   ```sh
   python3 e2e/engine-settings/run.py --engine-source /absolute/Engine \
     --target-dir /absolute/task-owned-engine-target
   ```

4. To execute the native iOS archive, use the isolated simulator mode:

   ```sh
   python3 e2e/engine-settings/run.py --platform ios-simulator \
     --engine-source /absolute/Engine --target-dir /absolute/task-owned-engine-target
   ```

   This mode requires the iOS 26.3 runtime and iPhone 17 Pro device type, as used by
   `e2e/environment/ios.mjs`. It creates its own simulator, boots it without opening
   Simulator.app, and runs only the command-line host through `simctl spawn`.
   It records the new simulator identifier and deletes only that simulator in cleanup.
   It does not install or launch the Mobile app. Boot and cleanup failures remain in
   the receipt. Keep any cleanup error separate from the primary failure.

The runner checks source identity, Cargo.lock identity, the prepared-artifact marker
and the generated Swift file. It records binding and Cargo.lock changes relative to
the previous Mobile pin. Review those changes before accepting a new contract. The macOS mode compiles and runs Swift against the packaging host dylib.
The simulator mode compiles and runs Swift against the prepared iOS simulator archive. It checks the source commit reported by the running Engine logs. It records
commands, exits, binary/source hashes and before/after settings
under a fresh `e2e/results/engine-settings-*` directory. Failure preserves that directory.
Do not reuse a results directory as a production profile.

The first three cases are fresh initialization, valid legacy product settings, and invalid
legacy product settings. Each saves an additional local-only relay through the public
binding, shuts down Engine, starts Engine with the same isolated host, and checks the
saved name and relay list. Existing Engine sections are compared after the save.
The secure store survives those Engine restarts only within this process. A new
process, OS secure storage, pairing, network connectivity and sync are not
covered. The rejection cases create an isolated original Space. No relay credential is supplied. The loopback URLs cannot reach a real relay.

Mobile's product settings implementation remains unchanged. Review its source diff
separately; this host does not execute React Native storage or the Android debug overlay.
The binding has no host log-profile parameter. Its rejection query reads Engine diagnostics. Verify
absent-profile semantics through Engine's existing `host_log_profile_e2e` test, rather
than extending the Mobile API solely for this check.


## Receive query, cancel and retry binding

The seventh case, `receive-api`, creates an isolated Space and one sender-side entry,
then calls the generated receive operations. It checks that the list is empty, the
sender entry has no receive snapshot, cancellation without an attempt is never reported as
`cancelled`, an empty retry selection fails as invalid input with `retryable=false`, an
unknown item is never accepted, and local history is still restorable. This proves the
generated symbols and checksums match the running library and that refusals stay
structured. It does not run a transfer: a real failed or cancelled attempt needs two
peers, which Engine's `host_adapter_contract/receive_retry` fixtures cover at the Engine
layer and a cross-device run must cover for the product. The case was added after the
bridge code, so it records its expectations from the Engine contract rather than from
Mobile code.

## Rejected pending input

Three additional cases seed synthetic historical inputs after creating an original
Space and encrypted history: unsupported format, malformed marker and missing runtime members.
Each case restarts Engine twice, calls session recovery and queries
`queryRejectedConfigImport`. It checks the original Space and device, old encrypted
history and a new encrypted write. It compares every staged member and the marker
before and after shutdown. The original staging tree must remain unchanged.

Each boot also injects a directory at the synthetic adoption-journal path. The
public query must throw `1411 / Internal / false`, never return null. Removing only
that injected fault must restore the original rejection query. Fixture setup and
byte assertions access synthetic files; product code uses only the public binding.
`rejection.json` records each boot, public reason/message, retained files and error fields.

These cases do not execute the Expo module or render the React Native notice.
Native app builds verify bridge compilation. UI presentation, dismiss/retry behavior
and real migration remain explicit manual acceptance items. Do not call them passed
from generated bindings, static checks or a host executable.
