# Engine main adaptation, 2026-09-10

## Source and scope

- Previous: `v1.1.0-rc.14`, `168a3ebd7c2701f2e9f8a0ebe0c4a0af4aa14543`.
- Target: `6e0095fe05b0522ddc6ecc7e7d34d915dea60a12`, verified against GitHub `main` before preparation.
- No published release covers this commit. Use the existing `local-build` preparation path and version `v1.1.0-rc.14.local.6e0095fe`.
- Build an exact detached checkout with isolated Cargo configuration; preserve the user's Engine checkout and existing mobile changes.
- `bindings/` has no source changes between these commits. Generated Swift and Kotlin bindings are byte-identical to the previous bindings.
- Engine retains the existing startup entry point. New startup progress is additive and is not exposed through the unchanged mobile binding; this upgrade does not add a progress UI.
- Changes include startup and legacy storage upgrade repairs, search rebuild improvements, active profile key reuse, authenticated LAN activity persistence, and admission cancellation retry.
- This source build is for development. The existing release validator deliberately rejects local builds; a published Engine release is still required for the mobile release workflow.

## Verification

- TypeScript check passed.
- ESLint: 0 errors, 305 existing warnings.
- Native preparation and integrity fixture tests: 5 passed. Added a failing-then-passing fixture proving local Maven versions match the pin while dependency versions remain unchanged.
- Corrected the local-build POM publication step: source version stays rc.14, published local Maven coordinate uses the full local pin version. The first Android app build caught this mismatch; the corrected build passed.
- Swift host tests: 65 passed, 1 failed. `testSynchronizedClipboardWriteDoesNotTriggerAnotherSync` also fails individually. Its implementation and tests are unchanged from HEAD, and this Swift package does not link the Engine binary or read the pin.
- All iOS Engine slices (device ARM64, simulator ARM64 and x86_64) and Android Engine slices (ARM64 and x86_64) compiled successfully from the pinned checkout.
- Both dist source markers match the target SHA. Prepared-file integrity verification passed after recording the actual artifact hashes.
- iOS Debug simulator app build, including extensions, passed. Installed and launched on iPhone 17 Pro (iOS 26.3); observed the home screen. Screenshot: `/tmp/mobile-engine-upgrade-ios.png`.
- Android `:app:assembleDebug` passed after the POM fix. Installed and launched on `UniClip_API_36`; observed the onboarding screen. Screenshot: `/tmp/mobile-engine-upgrade-android.png`. Peer refresh reported retryable Engine error 1382 (UNAVAILABLE); no successful peer synchronization is claimed.
- Full Jest run: 180 suites, 1304 tests passed. After the POM fix, 4 relevant suites / 57 tests passed again.
- No physical-device pairing, synchronization, or production profile upgrade was exercised. Simulator startup does not prove those behaviors.
- Logs are `/tmp/mobile-engine-upgrade-*.log`.

## iOS installation reuse follow-up

- The host storage launcher now creates a new staging directory on each invocation. The installer previously checked `source-commit.txt` inside that empty directory before checking the already-published framework, so an unchanged Engine was rebuilt.
- iOS installation now checks the published framework's source commit and all recorded hashes first. It retains a verified copy under `.artifacts/local/ios-cache`, including its original verification marker, and can restore that copy after the pinned framework replaces the installed one.
- Reuse decisions run under the existing publication lock. A new successful build is also retained before installation; a stale, incomplete, or corrupt copy is never accepted solely because its commit matches.
- Regression loop: `node --test scripts/__tests__/install-ios-engine-reuse.test.mjs`. Before the fix, both valid-output reuse cases reached the fake build's failure exit. After the fix, all 11 behavioral cases pass, including changed commits, missing/corrupt data and retaining a newly completed build.
- Combined Node script checks: 19 passed. Focused Jest checks: 38 passed. ESLint, Bash syntax and whitespace checks passed.
- Live check: invoked the real install script's `prepare_latest_engine ios` body through the actual `uni-build-storage --storage-run-mobile` launcher twice. Each call received a fresh staging directory, fetched actual `origin/main`, validated the real framework and printed `skipping Engine compilation`. Logs: `/tmp/mobile-ios-reuse-live-first.log`, `/tmp/mobile-ios-reuse-live-second.log`.
- This follow-up verified the preparation/reuse step, not another physical-phone installation. It does not migrate or delete the host's older compiler-cache directories.
