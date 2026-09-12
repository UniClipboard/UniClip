# iOS development installation repair — 2026-09-11

## Findings

1. The failed build used Engine `fe67a438` from `origin/main`, while mobile pins `b9b25fb2` and references its new diagnostic APIs. The first actual errors were missing `BindingHostDiagnosticAction`, `BindingHostDiagnosticSource` and related types. The blob-util nullability messages were warnings, not the cause.
2. After restoring the correct Engine, Debug linking failed on `facebook::react::Sealable::Sealable()`. The installed React device binary SHA256 was `7a9900db5ab911085d0091dc8b3c67abe647ee437da37a96facc3b29d22d3e57`, identical to the cached Release artifact. Its configuration marker was absent, and the upstream script explicitly skipped replacement because it assumed an unmarked artifact was Debug. The real Debug binary is `1a625683975534c298c62dd9fd3f912c3a5d908c05b3b4f45ebd5cd255c67d70` and exports the required constructor.
3. The resulting installed app crashed on startup on the connected iPhone running iOS 27 beta. The crash is in `React::Props::Props` called from prebuilt `ExpoModulesCore` during native view registration. Keeping application code, Engine and phone data unchanged while building Expo modules from source allowed startup; the user confirmed that the app now opens. This isolates the compatibility boundary to the prebuilt Expo/native Debug combination; the exact upstream binary-layout/build-flag defect was not independently established.

## Changes

- Both device-install paths select `core-source.json`'s exact source commit, fetching that commit only if absent locally. Existing caches and locked builds remain.
- iOS can reuse checksum-verified pinned files and record their local preparation metadata, rather than rebuilding or trusting a stale marker.
- After Pods installation, the development installer invokes React Native's own Debug replacement scripts. Missing configuration markers are marked Unknown so upstream code cannot silently assume Debug. Existing correct Debug artifacts remain reusable. Third-party source files are not patched.
- iOS development Pods and application builds explicitly use `EXPO_USE_PRECOMPILED_MODULES=0`, preserving the successful source-build configuration. The production/E2E Release configuration is not changed by this installer setting.

## Validation

- New pin-vs-main fixture reproduced the original selection bug, then passed after repair.
- New fixture runs the actual upstream RN script: an unmarked Release fixture remains Release without the repair, becomes Debug with it, and is reused on the next invocation without its archive.
- 27 Node script tests and 8 focused Jest tests passed. Scoped ESLint, Bash syntax and whitespace checks passed.
- Actual development build and installation on the connected iPhone succeeded, preserving the production app and existing data. Device launch succeeded after unlocking, and the user confirmed the source-built app opens successfully.
- Metro's HTTP endpoint was available; a live physical-phone inspector target was not independently observed, so this report does not claim debugger/Metro-session acceptance.

Logs: `/tmp/mobile-install-ios-original-build.log`, `/tmp/mobile-install-ios-fixed.log`, `/tmp/mobile-install-ios-final.log`, `/tmp/mobile-launch-crash.ips`, `/tmp/mobile-install-ios-source-expo.log`, `/tmp/mobile-source-expo-launch.json`, `/tmp/mobile-install-all-tests.log`.

## Separate termination observed

The post-source-build device report for PID 5622 at 20:42:44 is `SIGKILL`, `RUNNINGBOARD`, code `0xdead10cc`, with the main thread in the application run loop. It is not the original `Props::Props` SIGSEGV. The user confirmed normal opening, but sustained/background lifecycle stability is not established by this repair; this separate termination remains uninvestigated. Artifact: `/tmp/mobile-launch-source-crash.ips`.
