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

| Workflow            | Runs on                       | Does                                                                                                                                  |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `android-build.yml` | every push / manual release   | Build release APKs (all ABIs) → artifacts                                                                                             |
| `build-ios.yml`     | manual dev build / release    | Build the uc-mobile xcframework from pinned source, prebuild, archive, export a **distribution-signed `.ipa`** → artifact (no upload) |
| `release.yml`       | validated manual release only | Upload the `.ipa` to **TestFlight**; publish APKs to **GitHub Release** + **Gitee**                                                   |

All publishing lives in `release.yml`, so a failed lint / test / iOS build
blocks the GitHub/Gitee release _and_ the TestFlight upload.

## The uc-mobile xcframework

`modules/uc-core/ios/UniClipboardCore.xcframework` (293 MB, single `.a` >
GitHub's 100 MB file limit) and its `Bindings/` are gitignored, so they are not
in the checkout. `build-ios.yml` rebuilds them in CI from a **pinned commit** of
the source monorepo (`UniClipboard/UniClipboard`) via a shallow clone into the
runner temp dir — the app repo carries **no submodule**.

The pin is `UC_CORE_REF` at the top of `build-ios.yml`. It must stay compatible
with the committed `modules/uc-core/ios/UcCoreModule.swift` wrapper (the UniFFI
binding `uc_mobile.swift` is regenerated from the same commit, so it always
matches the compiled lib; only the hand-written wrapper is version-sensitive).

**To adopt a new uc-mobile version:** update `UC_CORE_REF` to the new full SHA,
and if the FFI surface changed, update `UcCoreModule.swift` (and the Kotlin /
JS bindings) to match.

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

Already configured for the Android release path (reused as-is): `GITEE_PRIVATE_KEY`,
`GITEE_ACCESS_TOKEN` (secrets) and `GITEE_OWNER`, `GITEE_REPO` (variables).

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
   the `.ipa` to TestFlight and publishes the APKs to GitHub + Gitee.
5. In App Store Connect → TestFlight: wait for processing, answer export
   compliance, add the build to a testing group.

**Manual iOS dev build** (no tag): Actions → `build` → _Run workflow_. Inputs:

- leave `upload_testflight` unchecked → runs `build-ios` only: rebuild
  xcframework, archive, export a signed `.ipa` artifact. No upload, no
  GitHub/Gitee release. Use it to validate the whole iOS toolchain or grab an
  `.ipa`.
- check `upload_testflight` → additionally uploads that build straight to
  **TestFlight**, without touching the Android / Gitee release. This is the
  clean "ship an iOS dev build to try" path.
- `build_number` (optional) overrides the CFBundleVersion for this run.

To ship both platforms, enable `publish_release`. CI requires matching tags in
`CHANGES.md` and `CHANGES.en.md`; a tag containing `beta` marks the
GitHub/Gitee release as a prerelease. The iOS side always goes to TestFlight,
with localized "What to Test" notes for `zh-Hans` and `en-US`; missing build
localizations are created automatically.

## Dev build vs release build

There is no separate dev/prod build configuration — same bundle ids, same
App Store Connect app record. The distinction is by channel:

- **iOS**: every build from this pipeline goes to **TestFlight** (Apple's beta
  channel). Promoting a build to the public App Store is a manual submit-for-
  review step in App Store Connect; it is not automated here.
- **Android**: a `beta` tag → GitHub/Gitee **prerelease**; a plain `v*` tag →
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
- **`Unresolved reference` / link errors compiling `UcCoreModule.swift`** — the
  `UC_CORE_REF` pin drifted from the committed wrapper; realign the pin or the
  wrapper.
