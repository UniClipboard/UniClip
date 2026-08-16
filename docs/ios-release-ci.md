# iOS Release CI (GitHub Actions)

Automated iOS build + TestFlight upload, modeled on the native iOS app repo's
`testflight.yml`. Runs entirely on GitHub-hosted `macos-26` runners — no EAS.

## Flow structure

`build.yml` orchestrates three reusable workflows:

```
push (any branch)       ──▶ code-style + unit-tests + android-build
manual iOS dev build   ──▶ build-ios (optional TestFlight upload)
manual full release    ──▶ validate + both builds ──▶ create tag ──▶ release
```

| Workflow            | Runs on                       | Does                                                                                                                 |
| ------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `android-build.yml` | every push / manual release   | Build release APKs (all ABIs) → artifacts                                                                            |
| `build-ios.yml`     | manual dev build / release    | Prepare the pinned unified engine, prebuild, archive, export a **distribution-signed `.ipa`** → artifact (no upload) |
| `release.yml`       | validated manual release only | Upload the `.ipa` to **TestFlight**; publish APKs to **GitHub Release** and **Cloudflare R2**                        |

All publishing lives in `release.yml`, so a failed lint / test / iOS build
blocks the GitHub release, R2 upload, and TestFlight upload.

## The unified engine

`modules/uc-engine/core-source.json` pins the engine release and source revision.
The platform artifacts are prepared by `npm run core:prepare` and checked by
`npm run core:verify` before Expo prebuild runs. The app repository does not
carry a source submodule.

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

1. **Bump the iOS build number** — `expo.ios.buildNumber` in `app.json` must be
   unique within the marketing version (`altool` does not auto-bump). Bump
   `expo.version` too if it's a new marketing version. Update `CHANGES.md` and
   `CHANGES.en.md` with matching tags.
2. Commit and push the release metadata to `main`. Do not create the tag.
3. Actions → `build` → _Run workflow_ on `main`; enable `publish_release` and
   leave the dev-build inputs empty.
4. CI validates metadata and both localized release-note sections, builds
   Android + iOS, creates the tag only after both builds succeed, then uploads
   the `.ipa` to TestFlight and publishes the APKs to GitHub and R2.
5. In App Store Connect → TestFlight: wait for processing, answer export
   compliance, add the build to a testing group.

**Manual iOS dev build** (no tag): Actions → `build` → _Run workflow_. Inputs:

- leave `upload_testflight` unchecked → runs `build-ios` only: rebuild
  xcframework, archive, export a signed `.ipa` artifact. No upload, no
  GitHub release or R2 upload. Use it to validate the whole iOS toolchain or grab an
  `.ipa`.
- check `upload_testflight` → additionally uploads that build straight to
  **TestFlight**, without touching the Android release. This is the
  clean "ship an iOS dev build to try" path.
- `build_number` (optional) overrides the CFBundleVersion for this run.

To ship both platforms, enable `publish_release`. CI requires matching tags in
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
