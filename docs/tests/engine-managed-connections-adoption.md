# Engine managed connections adoption

## Source identity

- Mobile base: `44a1750411bd67e3dd2290600e1291bc093fb6f6` (official main at task start).
- Previous Engine: `416fcca93ea6658b4e5918bafd464c6f850a17bc`.
- Pinned Engine: `2f9afc9956b0cda82e65c912f0c0f6dc6aa51256` (Engine PR #180).
- Both revisions declare `v1.1.0-rc.22`. `core-source.json` is the source authority;
  the npm workspace version and `package-lock.json` therefore remain unchanged.
- Engine's own `Cargo.lock` is consumed from the pinned checkout with `--locked`.
  Mobile does not vendor a second Rust lockfile. In particular, the target lock
  resolves `quinn-proto` to `0.11.18`, replacing `0.11.15`.

## Interface and artifact ownership

The UniFFI diff changes internal shutdown synchronization without changing its
exported interface. The Engine configuration additions are gated by `dev-tools`.
No Mobile bridge adaptation or product semantics decision is required by this
interface diff. JS/TS bridge files are handwritten; Kotlin and Swift bindings are
produced by UniFFI from the pinned host library.

`core:prepare` checks out the exact commit, builds native artifacts, then records
content hashes under `.artifacts/commit-<full-sha>/prepared.json`. Reuse requires
verification for the requested platform; sharing the `rc.22` version is insufficient.
Android's `preBuild` and the iOS pod script phase invoke this verification. Ignored
AARs, generated bindings, and XCFrameworks must be regenerated, never committed.
No local Engine override is part of this adoption.

## Validation

- Source validation against Engine main ancestry: passed.
- Existing preparation/pin/verification contracts: 10 passed.
- Mobile TypeScript check: passed.
- Mobile ESLint: 0 errors, 266 existing warnings. Excluded the task's `.cache`
  source clone explicitly; the first broad lint run picked up four foreign OHOS
  TypeScript files from that clone.
- Existing Mobile Engine contract tests: 2 suites, 19 tests passed.
- Android Engine release AAR: built for `arm64-v8a` and `x86_64`, with Rust 1.95.0,
  two Cargo jobs, and isolated Cargo/MBX/Gradle caches. Gradle completed all 28 tasks.
- Prepared Android verification and second prepare/cache reuse: passed.
- AAR JNI entries match the two built release libraries byte for byte; prepared
  Kotlin matches the binding generated during the same build.
- Swift binding generation: passed against the pinned host library.
- Nonvisual UniFFI host runtime contracts: 2 passed, using temporary profiles and
  an in-memory `BindingHost`: create space through the binding with analytics and
  shut down; retry shutdown after a zero-budget timeout, reopen the profile, and
  recover the session. These exercise real Engine persistence/runtime through
  Rust's MobileEngine interface, not React Native or a physical device.
- iOS XCFramework, Mobile APK/app bridge compilation, simulator/device execution,
  cross-device networking, and production-data upgrades: **not run**. The iOS
  prepared verifier correctly rejects this checkout because its XCFramework was
  not built. Generated Swift alone is not iOS native acceptance.

The initial Android attempt stopped before compilation because the local Cargo
storage wrapper rejected an internal-disk target. The successful build used a
new task-owned external-disk target and the pinned toolchain directly. Neither
old native output nor another worktree's cache was adopted.

## Artifact receipt

| Artifact | SHA-256 |
| --- | --- |
| Engine Cargo.lock | `e52cdafd6f0dbccea975980fe141bc555e42e6ca177b3f8d7b5bf37fe0fa466f` |
| Android AAR | `9ce8ddd62a224d452afd4b63a880b218e6203026ad091deddf304f0fe7629610` |
| Kotlin binding | `8b1c0e6dfb975a71612b93b3fea0e3a7bd33dd20759959b97fdb8c561b7a9439` |
| Swift binding | `c57d4cba098ec2c403aec4383b90df0665e10a577993f214b451a8e6a8cb2810` |

These identify this build, not a promise of byte-identical native rebuilds.
The task report's `library/` contains the full source manifest, prepared marker,
ABI hashes, build logs, and replay scripts. Native binaries remain ignored.

To prepare a fresh checkout using the standard mechanism:

```sh
npm ci
node scripts/validate-unified-engine-core-source.mjs
npm run core:prepare -- --platform android
node scripts/verify-unified-engine-core.mjs --prepared --platform android
npm run type-check
npm run lint
node --test scripts/__tests__/pin-unified-engine-commit.test.mjs scripts/__tests__/verify-unified-engine-core.test.mjs scripts/__tests__/prepare-local-engine.test.mjs
npm test -- --runInBand --watch=false src/__tests__/engineLatestContract.test.ts src/__tests__/engineRc6Contract.test.ts
```

Build source/caches must be isolated when reproducing the task's evidence. The
receipt's `build-android.sh` records those environment settings. No product
version, release, real-device data, or local Engine override changed.
