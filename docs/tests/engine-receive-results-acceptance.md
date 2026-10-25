# Engine receive results: failure model and acceptance entries

Engine pin: `5cbca8fc24a278fa7b01ae611bf4b925914bef13` (Engine PR #230 merge commit).
This document was written before the Mobile adaptation code. It fixes the failure
model first, names the existing real native/binding entry points that must exercise
it, and states what is deliberately not run on a development machine.

## Scope

Mobile consumes four Engine operations and one event:

| Engine operation | Mobile projection |
| --- | --- |
| `query_entry_receive_progress(entry_id)` | `queryEntryReceiveProgress(entryId)` |
| `list_entry_receive_progress()` | `listEntryReceiveProgress()` |
| `retry_entry_receive(entry_id, expected_attempt_id, item_ids)` | `retryEntryReceive(entryId, expectedAttemptId, itemIds)` |
| `cancel_entry_receive(entry_id, attempt_id)` | `cancelEntryReceive(entryId, attemptId)` |
| `ReceiveAttemptStateChanged` event | `receiveAttemptStateChanged` (invalidation only) |

The Mobile host does not download blobs, schedule retries, close connections or
edit the Engine database. Selection and display belong to the host. Validation,
scheduling and settlement belong to Engine.

## Failure model

Every row names the wrong host behavior it prevents. Each row is covered by at
least one executable check listed under "Checks".

| # | Situation | Required host behavior | Wrong behavior prevented |
| --- | --- | --- | --- |
| F1 | `retry` returns `accepted {attemptId}` | Keep the old items. Mark the entry as awaiting the new attempt. Re-query. | Showing "saved" because the request was accepted. |
| F2 | `accepted` arrives, then a late event names the old attempt | Re-query the Engine snapshot. Never copy the event payload into state. | An old attempt overwriting the new one. |
| F3 | Two queries for one entry complete out of order | Drop the response of the older request. | Rolling the view back to an older snapshot. |
| F4 | Aggregate state is `failed` or `cancelled` while some items are `completed` | Show per-item state. Keep delivered items completed and not selectable. | Treating the whole attempt as lost or deleting delivered files. |
| F5 | Item is `directory_unit` | One selectable unit. Retry sends exactly that `item_id`. | Member-level retry or member counts presented as item counts. |
| F6 | Aggregate state is `cancelling` or `failing` | Non-terminal. No retry offered. | Offering retry before the attempt settled. |
| F7 | Cancel returns `cancellation_incomplete` | Report "still cancelling". Re-query. | Reporting the attempt as cancelled. |
| F8 | Cancel returns `not_receiving`, `too_late`, `already_terminal`, `superseded` | Refresh and show the real state. | Showing a cancelled state that Engine did not confirm. |
| F9 | Retry returns `already_receiving`, `superseded` | Refresh. No second request. | Starting a duplicate attempt. |
| F10 | Retry returns `cancellation_incomplete` | Refresh. Show that the previous attempt is still ending. | Retrying on top of an unfinished cancellation. |
| F11 | Retry returns `unavailable {source_unavailable}` | Keep the failed items and saved files. Say the source is no longer available. | Fabricating a download after restart. |
| F12 | Retry returns `unavailable {access_denied}` | Keep state. Say access was denied. | Treating denial as a transient error and retrying in a loop. |
| F13 | Retry with an empty or invalid selection | The Engine call fails. Surface the structured failure. The host never builds `item_id` from file names or paths. | Guessing item identity. |
| F14 | Selection includes a completed item | The host does not offer it. Engine rejects it if it is sent. | Re-downloading delivered files. |
| F15 | Stale `expectedAttemptId` | Engine returns `superseded`. The host refreshes. | Retrying the wrong attempt. |
| F16 | Events are missed (background, event gap, app restart) | `list` rebuilds all state. Run it on start, on `refreshRequired`, and on foreground. | Relying on events for state. |
| F17 | The 120-second outbound UI wait elapses | Does not call `cancelEntryReceive`. | Treating a presentation timeout as an Engine cancellation. |
| F18 | Sender ACK is complete | Not used as a receiver per-file save receipt. | Reporting receiver files as saved from the sender report. |
| F19 | Native query throws (Engine stopped, runtime unavailable) | Keep the last snapshot, mark it stale, expose the error. | Clearing results because the query failed. |
| F20 | Unknown `kind`, `state`, `failureReason` or outcome string from a newer Engine | Preserve the raw string. Present it as unknown. Never offer retry for unknown state. | A crash or an invented state. |

## Binding and native identity failures

| # | Situation | Required result |
| --- | --- | --- |
| B1 | Old Swift or Kotlin binding with a new library, or the reverse | `verify-unified-engine-core.mjs --prepared` fails. Never accepted. |
| B2 | Prepared manifest declares a platform whose slice is missing | Verification fails. |
| B3 | AAR contains only arm64 | Android x86_64 is reported unsupported. No runtime claim. |
| B4 | UniFFI API checksum mismatch | Native bridge fails to load at test time. |
| B5 | Local Engine override or a developer absolute path is active | Not valid release provenance. The pin file and prepared manifest must name only the Engine commit. |

## Existing real entry points

| Entry | Covers | Used here |
| --- | --- | --- |
| `npm run core:prepare` | Builds the pinned Engine, all iOS slices, the AAR, generated Swift and Kotlin, and records hashes. | Yes |
| `npm run core:verify` (`verify-unified-engine-core.mjs --prepared`) | Hashes, manifest and platform slices (B1, B2, B5). | Yes |
| `src/__tests__/ucEngineModule.test.ts` | JS, Swift and Kotlin bridge parity for every exposed operation and event. Extended before the bridge code. | Yes |
| New jest suite `ReceiveResults.test.ts` | F1-F3, F5-F11, F13-F16, F19, F20 against the host service with a scripted native API. Written before the service. | Yes |
| Engine `crates/uc-engine/src/testing/host_adapter_contract/receive_retry/` | Real Engine retry, persistence, failure injection, restart (`source_unavailable`), stream isolation. | Engine-side; referenced, not re-run by Mobile. |
| `e2e/engine-settings/run.py` (macOS mode) | Real generated Swift against the real host dylib. A seventh `receive-api` case covers the generated receive symbols and structured refusals. | Yes; added after the bridge code, recording expectations from the Engine contract. |
| `modules/uc-engine/ios/Tests`, `android/src/androidTest` | Swift and instrumentation tests. | Compile checks only. No simulator or device is started. |
| `npm run test:e2e` (Maestro, real bundled app) | Cross-device scenarios. | **Not run.** It needs a simulator or emulator, which this task forbids. |

## Explicit non-execution

The following are not run and must be reported as NOT RUN, never as passed:

- Any simulator, emulator, VM, browser or physical device.
- Cross-device transfers, mixed-version pairs, retry after restart on a real profile.
- Android x86_64 runtime (the AAR slice is not produced for it unless the Engine
  script emits one).
- Visual acceptance. The user owns it.

## Known independent failures (not waived, not changed here)

- Engine dependency audit: `crypto-bigint 0.5.5`, `RUSTSEC-2026-0387` fails the
  Engine repository security job at the PR head and at the merge commit.
- Engine MBX R2 jobs fail at `Exercise R2 and Engine migration` with
  `R2 verification failed: prefetch, incomplete_prefetch`.

Neither is addressed by this Mobile change. Release stays blocked on the security
gate regardless of Mobile build results.

## Results

Results, hashes and the NOT RUN list are in
[engine-pr230-receive-adoption.md](engine-pr230-receive-adoption.md). Failure-model rows B3
and B5 are covered by that note's platform table and by `core:verify`. Rows F1-F3, F5-F11,
F13-F16, F19 and F20 are covered by `ReceiveResults.test.ts` and `ReceiveResultsSheet.test.tsx`.
Rows F4 and F12 are covered by the sheet tests. F17 is covered by a source-boundary
assertion. F18 is a non-change: the outbound delivery coordinator is untouched and nothing
reads sender ACK as a receiver save receipt. F11 and F13 also have a binding-level observation
from the `receive-api` case. B1, B2 and B5 are covered by `core:verify` and the pin file, and B4
by the binding E2E and by the native module builds.
