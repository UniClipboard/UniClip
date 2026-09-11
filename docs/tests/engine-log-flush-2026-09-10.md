# Mobile Engine log flushing, 2026-09-10

## Change

- Both native modules expose `flushEngineLogs`, using the existing process flush API with a 1,000 ms deadline. iOS runs it on the Engine operation queue.
- Diagnostic archives await the flush before discovering or reading Engine files. The manifest records `completed`, `incomplete`, or `unavailable`.
- Both platforms retain the observability installation result and expose current local writer health. Only fixed status values and dropped-record counts enter the manifest; native error descriptions do not.
- A failed flush or unavailable writer does not discard other available evidence. After the mobile-only handoff expansion, missing/unreadable Engine files are still detected but are recorded as manifest issues so other evidence can be exported.
- The iOS extension lifecycle flushes before returning from suspension, including failure paths. Asynchronous final Engine teardown flushes again because it can produce additional records. No process observability shutdown is added.
- The current Share extension stages content and opens the main application. It has no Engine dependency or Engine instance. The Keyboard extension uses the shared extension lifecycle. No unused Engine dependency was added to Share.
- Manifest flush/health status describes the exporting application process. It cannot flush another process. Existing files can contain records from multiple processes.
- Existing PostHog product logging is preserved. This does not add remote upload of full Engine diagnostics.

## Automated checks

- `npx jest src/__tests__/DiagnosticPackage.test.ts src/__tests__/ucEngineModule.test.ts src/__tests__/UnifiedEngineService.test.ts --runInBand --silent`: 56 passed.
- `swift test --package-path modules/uc-engine --filter ExtensionRuntimeLifecycleTests`: 6 passed.
- TypeScript check and scoped ESLint passed.
- iOS Debug simulator application build, including extensions, passed, both without signing for compilation and with normal simulator signing for App Group access.
- Android `:uc-engine:compileDebugKotlin` and `:app:assembleDebug` passed.

The archive tests exercise real ZIP creation with native/filesystem boundaries mocked. They cover delayed file publication, incomplete/throwing flush, failed health lookup, failed writer installation, and cancellation. These are not physical-device tests.

## Runtime evidence with the previously prepared Engine

These checks used the existing `6e0095fe` Engine package and the changed mobile wrapper. They must not be attributed to the requested local patch until repeated with its artifacts.

Temporary simulator-only entry code called the real native module and archive implementation. It was removed after testing, and `index.ts` was restored exactly. Real phones connected to Metro were excluded.

- iOS, iPhone 17 Pro / iOS 26.3: without observability installed, archive creation succeeded with two app logs and an explicit `unavailable`/`missing` Engine status.
- iOS: real installation and flushing returned ready/completed with zero dropped records. The archive contained 5 JSONL records; its newest record was at `15:20:55.572245Z`, immediately before archive generation at `15:20:55.574Z`. Explicit suspend/resume still allowed a successful flush.
- iOS process restart: the next archive contained 14 records, including the previous newest timestamp and newly appended records.
- Android, `UniClip_API_36` emulator: native flush/health calls and archive creation succeeded. Two Engine files were included with no unreadable files and zero reported dropped records.
- Android: after sending the application to the home screen and bringing it back, another archive succeeded and retained the previous Engine records. This proves export after background/foreground, not complete capture during arbitrary background-service termination.
- An isolated sponsor/joiner experiment reached pending admission, not a confirmed authentication failure. It is not an accepted authentication-failure test.

Local evidence summaries: `/tmp/mobile-logs-ios-unavailable-proof.json`, `/tmp/mobile-logs-ios-success-proof.json`, `/tmp/mobile-logs-ios-restart-proof.json`, `/tmp/mobile-logs-android-success-proof.json`, `/tmp/mobile-logs-android-background-proof.json`. These summaries contain counts, timestamps and fixed statuses rather than log payloads.

## Requested local Engine build

Source: `/Users/mark/.herdr/worktrees/engine/worktree-brave-harbor-fc60`, commit `288161390ebf54259b7044f4be3e3dd888fee4f6`.

The original checkout is preserved. Builds use a detached copy with the checkout's tracked changes and isolated Cargo configuration, because the host's global Git patches cause a locked build to fail. iOS and Android build logs are `/tmp/mobile-log-engine-build.txt` and `/tmp/mobile-log-engine-android.txt`.

Full local-artifact and real-extension/fault acceptance is tracked separately from the successful wrapper checks above.

## Local Engine independent-process check

The requested source was compiled into a macOS host library. Its generated Swift bindings are byte-identical to the bindings already used by the mobile module (`62e95d320e330953084258a66ba3de7f01162f36faff2f26e23bb0313d30cb42`).

Two standalone Swift processes used separate temporary stores and the actual UniFFI API. A sponsor issued an invitation; the joiner supplied the wrong passphrase. After a bounded flush, **before Engine shutdown**, the joiner read 13 records from disk, including 3 `authentication_rejected` connectivity records. Flush returned completed and reported zero dropped records. The join call itself returned pending; the rejection evidence comes from the on-disk records, not from interpreting pending as a failure.

Evidence: `/tmp/mobile-logs-local-auth-proof.json`. This proves the requested Engine's detailed failure records and flush API in independent native processes. It does not substitute for the same fault being exported by a mobile application using the newly built platform library.

## Real Keyboard extension process

On the iOS simulator, the already-enabled UniClip keyboard was opened in a text field without entering or submitting text. Its legacy simulator sync setting initially selected LAN; the original settings were saved, temporarily switched to P2P through the native settings API, and then restored with a semantic equality check.

With the main application terminated, the real Keyboard extension process attempted Engine startup, reported an unavailable error (1214), and stopped. Six new Engine records, including task shutdown records, appeared in the shared log file between `15:45:49.595785Z` and `15:45:50.723154Z`. Switching back to the system keyboard completed the dismissal. This exercises the extension's failure/cleanup path, not a successful keyboard synchronization. Evidence: `/tmp/mobile-logs-keyboard-proof.json`.

## Completed local platform preparation

Both iOS universal and Android ARM64/x86_64 Engine packages completed from the requested `28816139` source snapshot. The local iOS verification marker was recorded; Android's complete AAR is `/tmp/mobile-logs-local-engine.aar`. The later mobile-only changes do not modify Engine source or its binding contract.

An Android application using the new local ARM64 library exported an authentication-rejected connectivity event at `2026-09-10T15:56:06.814068Z` in an archive generated at `15:56:12.851Z`. The binding did not expose a distinct failure event to the test, so this is evidence of a real failure record being exported, not a claimed immediate failure notification. Proof: `/tmp/mobile-logs-local-android-auth-proof.json`.
