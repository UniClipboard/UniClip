# iOS Release CI (GitHub Actions)

Automated iOS build + TestFlight upload, modeled on the native iOS app repo's
`testflight.yml`. Runs entirely on GitHub-hosted `macos-26` runners — no EAS.

## Flow structure

The build and release entrypoints are separate:

```text
build.yml:   main push / manual development build -> quality checks -> builds
build-pr.yml: pull request -> quality checks -> builds
release.yml: manual release -> Prepare -> selected builds -> create tag -> publish.yml
```

| Workflow | Responsibility |
| --- | --- |
| `build.yml` | Main-push CI and manual development builds, including optional TestFlight uploads |
| `release.yml` | Manual release entry; validate metadata, build selected platforms, create tag, publish |
| `android-build.yml` | Reusable Android `arm64-v8a` APK build and artifact upload |
| `build-ios.yml` | Reusable Engine preparation, prebuild, archive and signed IPA export; optional dev upload |
| `publish.yml` | Reusable TestFlight, GitHub Release, R2 and FlareRelease publishing |

The release workflow runs no unit tests, lint or coverage checks. Failed release
preparation or a selected platform build blocks tagging and publishing. PR, main-push
and manual development builds retain their quality gates. Releases and development
TestFlight uploads share the `uniclip-release` concurrency group and never cancel an
in-progress run, because they consume the same build counter.

## The unified engine

`modules/uc-engine/core-source.json` pins the engine release and source revision.
The platform artifacts are prepared by `npm run core:prepare` and checked by
`npm run core:verify` before Expo prebuild runs. The app repository does not
carry a source submodule. The pinned Engine itself keeps its network stack in a
submodule (`third_party/iroh`). `scripts/engine-source-checkout.sh` creates the
Engine worktree for both `core:prepare` and the device install script and populates
that submodule, or stops with a message naming it when it cannot be fetched.

To adopt a new engine release, update the pinned source through the repository's
engine preparation workflow, then verify both platform artifacts before changing
the app wrappers.

## Required repository secrets

Add under **Settings → Secrets and variables → Actions**. These are the same
Apple credentials the native iOS app repo uses (identical team `8XG39X5CL8` and
bundle ids), so the certs / key / profiles are shared.

| Secret                 | What                                                    |
| ---------------------- | ------------------------------------------------------- |
| `ASC_API_KEY_ID`       | App Store Connect API key id (e.g. `77DMDM7BYZ`)        |
| `ASC_API_ISSUER_ID`    | Issuer id (UUID) — from Users and Access → Integrations |
| `ASC_API_KEY_P8`       | base64 of `AuthKey_<id>.p8` (App Manager role)          |
| `DIST_CERT_P12_BASE64` | base64 of the Apple **Distribution** cert + key `.p12`  |
| `DIST_CERT_PASSWORD`   | password of that `.p12`                                 |
| `DEV_CERT_P12_BASE64`  | base64 of the Apple **Development** cert + key `.p12`   |
| `DEV_CERT_PASSWORD`    | password of that `.p12`                                 |

## One-time setup: App Store provisioning profiles

Export uses **manual** signing against three pre-created App Store profiles
(automatic export signing would need an Admin-role API key). Create them once
locally (idempotent — re-run to refresh after a cert rotation):

```bash
ruby scripts/asc_profiles.rb create <ASC_API_KEY_ID> <ASC_API_ISSUER_ID> <AuthKey_*.p8>
```

This makes `UniClipboard App Store`, `UniClipboard Share App Store`, and
`UniClipboard Keyboard App Store`. If the native iOS app repo already created
them, this app reuses the same ones (same bundle ids). CI installs them each run
via `asc_profiles.rb install`.

## Cutting a release

1. **Bump the build counter** with `npm run release:build` (see
   `docs/RELEASE.md`). The counter is shared by both platforms and by every
   published artifact, so the number must be newer than every release tag and
   every build already on App Store Connect. Bump `expo.version` too if it's a
   new marketing version. Update `CHANGES.md` and `CHANGES.en.md` with
   matching tags.
2. Commit and push the release metadata to `main`. Do not create the tag.
3. Actions → `release` → _Run workflow_ on `main`; choose
   `platforms` (`both`, `android`, or `ios`).
4. CI validates metadata and both localized release-note sections, refuses a
   build number that a release tag or App Store Connect already has, builds
   the selected platforms, creates the tag only after those builds succeed,
   then uploads the `.ipa` to TestFlight and/or publishes the APK to GitHub
   and R2.
5. In App Store Connect → TestFlight: wait for processing, answer export
   compliance, add the build to a testing group.

**Manual iOS dev build** (no tag): Actions → `build` → _Run workflow_; select
`platforms: ios`. Quality checks run before the build. Inputs:

- leave `upload_testflight` unchecked → runs `build-ios` only: rebuild
  xcframework, archive, export a signed `.ipa` artifact. No upload, no
  GitHub release or R2 upload. Use it to validate the whole iOS toolchain or grab an
  `.ipa`.
- check `upload_testflight` → additionally uploads that build straight to
  **TestFlight**, without touching the Android release. This is the
  clean "ship an iOS dev build to try" path. The upload consumes a number of
  the shared build counter, so the job fails before archiving when that
  number is not newer than every release tag and App Store Connect build.
  Bump with `npm run release:build` and push first.
- `build_number` (optional) overrides the CFBundleVersion for this run; the
  same uniqueness check applies to the override.

A number consumed this way is not tagged. The next release's check sees it on
App Store Connect and asks for `npm run release:build -- --after N`.

To publish a release, run the separate `release` workflow. It requires matching tags in
`CHANGES.md` and `CHANGES.en.md`; an Alpha tag (`-alpha.N`) marks the
GitHub release as a prerelease. The iOS side always goes to TestFlight,
with localized "What to Test" notes for `zh-Hans` and `en-US`; missing build
localizations are created automatically.

## Dev build vs release build

There is no separate dev/prod build configuration — same bundle ids, same
App Store Connect app record. The distinction is by channel:

- **iOS**: every build from this pipeline goes to **TestFlight** (Apple's beta
  channel). Promoting a build to the public App Store is a manual submit-for-
  review step in App Store Connect; it is not automated here.
- **Android**: an Alpha tag → GitHub **prerelease**; a plain `v*` tag →
  the normal "latest" release.

## Troubleshooting

- **`error: exportArchive Copy failed`** — Homebrew rsync shadowing system
  rsync. The export step already prefixes `PATH` with `/usr/bin` to avoid it.
- **`profile '… App Store' not found`** — run the `asc_profiles.rb create` step
  above; the profiles don't exist on the account yet.
- **Cloud signing permission error** — the API key lacks signing management;
  ensure it has the **App Manager** role (not Developer).
- **Duplicate build number rejected on upload** — step 1 was skipped; bump
  `expo.ios.buildNumber`, update both changelog files, and start a new release.
- **Link errors compiling `UcEngineModule.swift`** — the prepared engine artifact
  and the committed wrapper are out of sync; re-run preparation and verification,
  then align the wrapper if the engine interface changed.

Engine commit pin 的源码构建与 MBX/R2 权限边界见 [Engine 编译缓存](engine-compiler-cache.md)。
