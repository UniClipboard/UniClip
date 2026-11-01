# Mobile Engine source adoption

## Source contract

Mobile adopts Engine `f3ffe490b30a82410400388a8dea10a76e71a82b` from
`357d7f64006789285fe5bfc4f025992bc9b84e5f`.
The remote `main` query returned the target commit on 2026-11-01.
Both commits declare `v1.1.0-rc.23`. The full source commit identifies this upgrade.
`core-source.json` selects commit artifacts. The workspace package version and
`package-lock.json` remain `1.1.0-rc.23` because the declared version did not change.
The pinned Engine Cargo.lock controls native dependencies through locked builds.

The Engine changes include recoverable process and startup release owners,
entry-scoped thumbnail reads, locked-cache access restrictions, Cargo checkout
source verification, shutdown fixes and post-commit blob-worker notifications.

## API compatibility

Mobile does not call `ReadThumbnail` or consume Engine history projection fields
`thumbnail_url`, `image_width` or `image_height`. Mobile owns its local SQLite
history. The removed Rust fields do not require Mobile history or UI changes.

The generated UniFFI interface adds process release/resume reports and startup
release reports. Existing start, lifecycle and host clipboard entry points remain
available. Mobile does not expose process observability teardown. This adoption
keeps existing lifecycle behavior; it does not add a process release feature.
The new startup cleanup reports do not by themselves repair existing host cleanup
ownership gaps. Those gaps require separate host changes and failure acceptance.

The existing settings E2E host still used the older void clipboard-write callback.
Its callback now returns `Data?` with `nil`, matching the generated binding.
The synthetic host does not invent a clipboard identity.

Both native hosts return unknown clipboard identity. Engine retains unknown
observations. This upgrade does not establish no-echo acceptance.
The independent t-0416 worktree contains uncommitted capture and clipboard changes.
This adoption does not include those changes. No content, timestamp, timer or
transferable marker is used to infer Engine clipboard identity.

## Reproduction

Use Node 22.22.1, the pinned Rust toolchain, an Android SDK and NDK, and Xcode.
Use a fresh Mobile checkout for this procedure. Keep all validation data in a
fresh task-owned directory. Use a clean Engine checkout at the adopted commit.
Do not change another task's Engine checkout.

Set these paths before the first preparation. Keep the host target on the external
build disk when using the local storage wrapper:

```sh
engine_checkout=/absolute/isolated/Engine
engine_host_target=/Volumes/ExternalSSD/cargo-targets/verification/mobile-engine-adoption
```

Run all steps from the Mobile repository root. Commands that enter a platform
directory use a subshell and return to the repository root.

1. Verify the Engine checkout HEAD is `f3ffe490b30a82410400388a8dea10a76e71a82b`.
2. Run `npm ci`.
3. Run `npm run core:pin -- f3ffe490b30a82410400388a8dea10a76e71a82b --engine-dir "$engine_checkout"`.
4. Prepare the Engine with the retained host target:

   ```sh
   UC_ENGINE_REPOSITORY="$engine_checkout" \
     UC_ENGINE_LOCAL_TARGET_DIR="$engine_host_target" npm run core:prepare
   ```

5. Run `npm run core:verify`.
6. Run `npm run check:quality`.
7. Run `APP_VARIANT=test npx expo prebuild --no-install`.
8. Run `(cd ios && pod install)`.
9. Build the iOS app and extensions without signing:

   ```sh
   APP_VARIANT=test xcodebuild build \
     -workspace ios/UniClipTest.xcworkspace -scheme UniClipTest \
     -configuration Release -destination 'generic/platform=iOS Simulator' \
     CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
   ```

10. Run `(cd android && APP_VARIANT=test ./gradlew assembleRelease)`.
11. Execute the existing host with the same retained target:

    ```sh
    python3 e2e/engine-settings/run.py --engine-source "$engine_checkout" \
      --target-dir "$engine_host_target"
    ```

12. Record the prepared marker, binding hashes, native hashes, Cargo.lock hash and runtime source.

Set `APP_VARIANT=test` for prebuild and each application build. The native test IDs
do not set the embedded Expo configuration by themselves. Verify `extra.appVariant`
in each embedded `app.config` before accepting a test artifact.

Setting `UC_ENGINE_LOCAL_TARGET_DIR` before the first preparation retains the
host dylib, Swift binding and C headers. A preparation without this setting can
use a temporary target that the storage wrapper deletes. If a prepared marker
already exists, repeating preparation can reuse that marker without rebuilding
the missing host files. Use a fresh Mobile checkout for the retained-target procedure.
The host uses synthetic secure storage, synthetic clipboard data and fresh profiles.
It does not access the system clipboard or an OS keychain.

## Acceptance boundary

A compiled AAR or XCFramework establishes native build coverage.
A full application build establishes bridge and extension compilation coverage.
The command-line host establishes real Engine behavior through generated Swift bindings.
None of these checks establishes physical-device, Android runtime, native clipboard,
peer synchronization or visual acceptance. Record each unexecuted boundary explicitly.
