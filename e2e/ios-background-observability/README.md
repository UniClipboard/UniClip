# Background observability ownership

## Failure modes recorded before implementation

1. LAN-only startup installs the process logger without an Engine. The network lease stays locked when the background activity ends.
2. A flush returns success while the network lease stays locked.
3. Pending or failed process release ends the background activity.
4. Foreground work resumes an Engine before process observability resumes.
5. A stale foreground callback reopens files after a newer background callback.
6. A native network callback queues a journal write after the final background record.
7. A journal flush times out, but the activity ends while a queued writer can still hold a lock.
8. Foreground return leaves the logger parked. A second background cycle uses an old release receipt.
9. Background entry precedes the queued startup logger installation. That installation reopens files after completion.
10. The host database reports a failed close, but native treats its receipt as successful.

## Host end-to-end verification

Run the real pinned Engine process logger with the production Swift lifecycle coordinator.
Use a temporary directory and synthetic data. Probe the actual network lease from a separate
Python process. The regular-mode scenario has no MobileEngine, server, or space. A second scenario
starts a real Engine, creates synthetic encrypted history, suspends and resumes the Engine, and
restores that history. Both scenarios use in-memory key storage and a synthetic clipboard.
The background activity models UIKit. It records a lease probe at the exact activity-end boundary.
It does not prove RunningBoard behavior on an iPhone.

```sh
python3 e2e/ios-background-observability/run.py \
  --binding <source-matched-uc_engine_uniffi.swift> \
  --include <source-matched-binding-headers> \
  --library <source-matched-libuc_engine_uniffi.dylib> \
  --output <new-evidence-directory>
```

Use `--revision HEAD` before the fix to capture the original failure without switching branches.
The runner copies production source from the selected revision. It also copies the production
process lifecycle adapter and the module's lifecycle initializer. Artifacts include source and
library hashes, command output, runtime source identity, checks, and lock probes.

Controlled failure scenarios also verify pending release, failed release, failed database close,
final journal flush failure, foreground ordering, and rejection of a queued logger installation.

## Required device acceptance

Install a build with this change on a physical iPhone. Disconnect the debugger. Select regular
mode with no server or space. Repeat Home and foreground return at least three times. Confirm
that the PID stays unchanged and that each completed background transition has no pending owner.
Repeat with a LAN server, with P2P, and with a keyboard or share-extension handoff. A host pass
does not replace these checks.
