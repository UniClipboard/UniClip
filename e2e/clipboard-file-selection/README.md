# Clipboard file selection replay

This directory contains controlled flow replays for issue [#100](https://github.com/UniClipboard/UniClip/issues/100).
Read `failure-modes.md` before changing the writers.
The failure modes and executable replay cases preceded the product fix.

## Run the native writer flows

Use macOS with Xcode, Python 3, and cached Kotlin 2.1.20 compiler dependencies.
The Kotlin replay also needs the cached `org.json` JVM library.
The runners do not install dependencies.
Use a new output directory for each run.

```sh
python3 e2e/clipboard-file-selection/run.py --output /tmp/clipboard-selection-swift
python3 e2e/clipboard-file-selection/run-kotlin.py --output /tmp/clipboard-selection-kotlin
```

Each runner copies production functions from the current checkout.
The Swift runner executes `clipboardWrite`, the resolver, and the share cache.
The Kotlin runner executes `clipDataForSnapshot`, its resolver, and the share cache.
Each runner uses real temporary files and an in-memory OS boundary.
Each runner checks 16 cases and writes logs plus a receipt.
The receipt includes source hashes, output hashes, and the fixture identity.
The fixture contains 793 bytes. Its display name is `原始文件.txt`.

To reproduce the failure, add the following option to either command:

```text
--source-ref 738ad9dcc85b96ddf76d597b4fb4e7156c8d9bd4
```

The baseline must exit with status 1 after compilation succeeds.
Its text-first case must fail. Its file-first case must pass.
A compiler error alone is not reproduction evidence.

The fallback keeps the original order of non-file representations.
A valid file wins over text, HTML, RTF, and image representations.
The resolver rejects missing files, directories, remote URLs, and symlink escapes.
The writer skips rejected file-list representations when another representation is available.
The writer reports unavailable when only rejected file-list representations remain.
A selected file-handle or copy failure propagates as an error.
The writer does not replace a failed selected file with accompanying path text.
This change does not implement the separate plain-text preference requested by issue #43.

## Check the native SDK APIs

Run both writer replays first. Then run:

```sh
python3 e2e/clipboard-file-selection/check-native-api.py \
  --swift-replay /tmp/clipboard-selection-swift \
  --kotlin-replay /tmp/clipboard-selection-kotlin \
  --android-sdk "$ANDROID_HOME" \
  --output /tmp/clipboard-selection-native-api
```

This command type-checks the writer bodies against UIKit and the Android SDK.
It uses cached AndroidX Core 1.18.0.
Binding records and file-handle registries remain doubles.
This command does not build an application or an Engine artifact.

## Replay the monitor chain and Engine ledger

Set `UC_REPLAY_NODE_MODULES` to a checkout that already has TypeScript installed.
The monitor replay loads the production TypeScript modules through a controlled loader.
It exercises the monitor and observer in six foreground/background scenarios.
OS reads, OS events, storage, and the Engine endpoint remain doubles.

```sh
UC_REPLAY_NODE_MODULES=/path/to/mobile node \
  e2e/clipboard-file-selection/run-monitor.cjs /tmp/clipboard-selection-monitor
python3 e2e/clipboard-file-selection/run-ledger.py \
  --engine-repo /path/to/Engine --output /tmp/clipboard-selection-ledger
```

The ledger runner reads the exact Engine commit from `core-source.json` with `git show`.
It preserves the ledger function bodies and replaces runtime imports and logging.
It uses a standard mutex adapter and synthetic guard keys.
It proves two contract gaps in the pinned ledger:

1. A `files:` write does not attribute a later `text:` projection as its echo.
2. A pending `files:` fallback can attribute a different user file as a remote push.

The ledger runner exits with status 0 when it reproduces these gaps.
Its receipt always sets `acceptancePassed` to `false`.
The monitor replay verifies that a later different user text reaches the Engine endpoint.
Neither replay proves that the complete Engine/OS chain preserves every user copy.

The Engine owns attribution. The Mobile patch adds no suppression ledger or time window.
The public host contract has no write generation or normalized read-back receipt.
A safe attribution fix needs an Engine-owned contract that binds an observation to a successful
native write after file materialization, including ordering and failure retirement.
A JS-only content cache cannot establish that identity for delayed Android captures.

## Device validation: NOT RUN

Do not run this checklist without device-execution authorization.
Do not use a production App Group, Engine profile, database, keychain, or clipboard.

1. Build isolated iOS and Android application IDs with isolated storage and synthetic identities.
2. Use a clean test simulator or emulator. Disable shared clipboard with the host.
3. Copy only the synthetic fixture. Enable clipboard monitoring and automatic push.
4. Deliver both representation orders. Paste into a file-capable receiver.
5. Save the pasted file. Compare its SHA-256, byte count, and filename with the fixture receipt.
6. Repeat with text-only, HTML/RTF, rejected file lists, and invalid handles.
7. Correlate native write completion, clipboard generation, JS observation, Engine attribution,
   and outbound entry identity. Use a synthetic content hash instead of private text.
8. Verify zero new outbound entries for the applied remote generation.
9. Immediately copy different text, then a different file. Verify one outbound entry for each.
10. Repeat in iOS foreground/resume and each Android foreground/background access mode.
11. Export event ordering, file hashes, source commits, and artifact hashes to an isolated receipt.

A successful type check or controlled replay does not satisfy device acceptance.
An equal byte count does not prove equal content.
