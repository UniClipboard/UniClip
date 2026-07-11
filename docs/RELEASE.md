# Release & Versioning Guide

This document describes the versioning policy, upstream-sync workflow, and
release process for UniClip.

## Versioning Policy

UniClip uses **two independent axes**, so our fast release cadence does not keep
re-triggering iOS App Store / TestFlight review:

1. **Marketing version** — `expo.version`, a 3-segment `MAJOR.MINOR.PATCH`
   ([SemVer](https://semver.org/)), independent from the upstream
   `Jeric-X/syncclipboard-mobile` project. This maps to the iOS
   `CFBundleShortVersionString`. **Apple re-reviews whenever this changes**, so
   it is bumped **deliberately and rarely** — at feature milestones, not every
   release.
   - **PATCH (`1.0.X`)** — bug fixes only, no user-visible behavior change.
   - **MINOR (`1.X.0`)** — new features, backward compatible.
   - **MAJOR (`X.0.0`)** — breaking changes (protocol break, removed feature,
     data-format migration).
2. **Build counter** — a single monotonic integer bumped **every** release. It
   drives both `expo.android.versionCode` and `expo.ios.buildNumber` (kept
   equal), and is the 4th segment of the git tag. On iOS only the
   `CFBundleVersion` changes → no review. Our fast cadence rides on this axis.

> **Snapshot point:** version `1.0.11` (versionCode 152) was the alignment
> snapshot where UniClip last shared a version number with upstream. From then
> on the two axes evolve independently.

### Build Counter Rule

The build counter **must increase monotonically** across every published
artifact, including betas and marketing-version bumps (it is never reset). The
rule is simple:

> Every published tag bumps the build counter by 1;
> `versionCode` and `ios.buildNumber` are both set to it.

| Release    | expo.version (iOS marketing) | build counter | Android versionName | iOS review? |
| ---------- | ---------------------------- | ------------- | ------------------- | ----------- |
| v1.3.0.156 | 1.3.0 (frozen)               | 156           | 1.3.0.156           | no          |
| v1.3.0.157 | 1.3.0 (frozen)               | 157           | 1.3.0.157           | no          |
| v1.4.0.158 | 1.4.0 (bumped)               | 158           | 1.4.0.158           | **yes**     |
| v1.4.0.159 | 1.4.0 (frozen)               | 159           | 1.4.0.159           | no          |

### Android self-update depends on the tag — do NOT change its shape

Android is sideload-only: the in-app updater (`src/services/UpdateService.ts`)
compares the **installed `versionName`** against the **latest GitHub release
tag**. Two hard constraints follow:

- The Android `versionName` MUST carry the build counter as a 4th segment
  (`1.3.0.156`). This is injected at prebuild by
  `plugins/withAndroidBuildVersionName.ts` (from `expo.version` +
  `expo.android.versionCode`). Without it, a user already on the newest build
  compares `1.3.0` against tag `v1.3.0.156` and sees a **permanent false
  "update available"**.
- The tag MUST be a form `parseVersion` accepts: `vX.Y.Z`, `vX.Y.Z.B`, or
  `...-betaN`. Separators like `v1.3.0-b5` or `v1.3.0+5` **fail to parse** and
  silently disable update detection.

### Tag Naming

- **Stable:** `vX.Y.Z.B` (e.g. `v1.3.0.156`) — the `.B` is the build counter.
- **Pre-release:** `vX.Y.Z.B-betaN` (e.g. `v1.3.0.156-beta1`).

The CI workflow detects the channel via `contains(github.ref_name, 'beta')` and
marks the GitHub Release accordingly. iOS reads its marketing version from
`app.json` `expo.version` (always 3-segment), so the tag's 4th segment never
reaches the iOS `CFBundleShortVersionString`.

## CHANGES.md Format

The first line of each version section is the bare tag (`vX.Y.Z.B`); the CI
extracts release notes with:

```sh
awk 'NR==1{next} /^$/{exit} {print}' CHANGES.md > feature.txt
```

So **keep the first-line tag format unchanged**. Every bullet must be prefixed
with a provenance tag:

- `[upstream]` — change ported from `Jeric-X/syncclipboard-mobile` or
  `Jeric-X/SyncClipboard`. Include a ref to the upstream commit/PR when
  possible.
- `[uc]` — UniClip-specific change (feature, refactor, branding, UI, etc.).

### Example

```
v1.0.12
- [upstream] Fix: clipboard sync stops after device sleep (ref: Jeric-X/syncclipboard-mobile@abc1234)
- [uc] Feature: add in-app APK update notification
- [uc] Refactor: extract sync coordinator from HomeScreen

v1.0.11
- [upstream] Fix: auto-upload SMS verification code stops working after 6h background runtime on Android 14+
- [uc] Rebrand to UniClip, migrate to UniClipboard/uc-android
- [uc] Built-in APK update download
- [uc] New app icon
```

## Upstream Sync Workflow

UniClip is a **clean-room re-implementation** of the SyncClipboard protocol
(TypeScript / Expo), not a git-level fork of the upstream Android app. Merging
is therefore manual.

Routine:

1. **Watch** `Jeric-X/syncclipboard-mobile` and `Jeric-X/SyncClipboard` on
   GitHub for new releases.
2. **Triage** new commits since the last sync. Focus on:
   - **Protocol-layer** changes (API fields, signatures, file chunking,
     SignalR contracts) — must port; servers are shared.
   - **Cross-platform logic** bugs (sync race conditions, retry logic) —
     usually applicable.
   - Android-platform fixes (background services, permissions) — port only if
     UniClip exhibits the same issue.
   - **Skip** anything specific to upstream's stack (MAUI, .NET, their UI).
3. **Port manually** into UniClip's corresponding module
   (`modules/*`, `src/services/*`, plugins, etc.). Do not `cherry-pick` —
   technical stacks differ.
4. **Commit** with an upstream reference, e.g.:

   ```
   fix: handle sync retry after token refresh

   Ref: Jeric-X/syncclipboard-mobile@abc1234
   ```

5. **Record** the change in `CHANGES.md` under the current development
   version, prefixed with `[upstream]`.

### Tracking the Sync Point

When a UniClip release ships, optionally record the upstream version it has
been synced to in the release notes or the in-app About page, e.g.
"Tracked upstream: v1.0.13 (2026-06-XX)". UniClip's own version stays
independent.

## Release Workflow

### Pre-release Checklist

- [ ] All upstream fixes intended for this release have been ported and
      recorded in `CHANGES.md`.
- [ ] Beta build (if one was published) has been verified on a physical
      device, including any long-running scenarios mentioned in the
      changelog.
- [ ] `CHANGES.md` top section reflects the final release notes (this becomes
      the GitHub/Gitee release body); its first line is the full tag `vX.Y.Z.B`.
- [ ] `app.json` build metadata was bumped with the scripts below (never
      hand-edit `versionCode` / `buildNumber` — that risks the two drifting).
- [ ] Working tree is clean.
- [ ] The release metadata commit has been pushed to `main`.

### Steps

Pick the axis. **Most releases are build-only** (marketing version frozen, no
iOS review):

```sh
# 1a. Build-only release (frequent): bump the counter, keep expo.version frozen.
npm run release:build            # add --dry-run first to preview

# 1b. OR marketing-version release (rare, re-triggers iOS review):
npm run release:version -- 1.4.0
```

Both scripts edit `app.json` and print the derived tag. Then:

```sh
# 2. Add a "vX.Y.Z.B" section to the TOP of CHANGES.md (first line = the tag).

# 3. Commit and push the release metadata. Do not create or push the tag.
git add app.json CHANGES.md
git commit -m "chore(release): X.Y.Z.B"
git push origin main
```

In GitHub Actions, open `build`, choose **Run workflow** on `main`, enable
`publish_release`, and leave the iOS dev-build inputs empty. The workflow then:

1. Validates that Android/iOS build counters and the first line of `CHANGES.md`
   describe the same release.
2. Runs style checks, unit tests, and both Android and iOS builds.
3. Creates the derived tag only after every check and both builds succeed.
4. Uploads the same validated iOS artifact to TestFlight.
5. Publishes a GitHub Release with the APKs (`arm64-v8a`, `armeabi-v7a`,
   `x86_64`, `universal`). This job does **not** wait for the Gitee jobs.
6. Mirrors the repository to Gitee and creates a matching release without
   deleting unrelated prior releases.
7. Uploads 3 ABI APKs to Gitee (`universal` is skipped due to Gitee's
   upload size limits).

Directly pushing a `v*` tag does not publish a release. If a publishing job
fails after the tag was created, use **Re-run failed jobs** on the same Actions
run so successful builds and destinations are not repeated.

### Beta Release

Use `vX.Y.Z.B-betaN` (for example `v1.3.0.156-beta1`) as the first line of the
top `CHANGES.md` section, then use the same manual `publish_release` flow. The
`.B` build-counter segment is required so the derived tag matches
[Tag Naming](#tag-naming) and stays compatible with `parseVersion` / Android
update detection. CI marks the release as a prerelease when the derived tag
contains `beta`.

## Identifier Reference

| Field            | Value                      |
| ---------------- | -------------------------- |
| Android package  | `app.uniclipboard.android` |
| iOS bundle       | `app.uniclipboard.ios`     |
| App display name | `UniClip`                  |
| Expo slug        | `uniclip`                  |

These are independent namespaces from upstream. UniClip can be installed
alongside any other SyncClipboard-protocol client on the same device.
