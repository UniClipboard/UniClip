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
- [ ] `main` is up to date with the latest CI green.

### Steps

Pick the axis. **Most releases are build-only** (marketing version frozen, no
iOS review):

```sh
# 1a. Build-only release (frequent): bump the counter, keep expo.version frozen.
npm run release:build            # add --dry-run first to preview

# 1b. OR marketing-version release (rare, re-triggers iOS review):
npm run release:version -- 1.4.0
```

Both scripts edit `app.json` and print the exact tag + git commands. Then:

```sh
# 2. Add a "vX.Y.Z.B" section to the TOP of CHANGES.md (first line = the tag).

# 3. Commit, push, tag (the tag push triggers the release workflow).
git add app.json CHANGES.md
git commit -m "chore(release): X.Y.Z.B"
git push origin main
git tag vX.Y.Z.B
git push origin vX.Y.Z.B
```

The tag push triggers the `build.yml` workflow on GitHub Actions, which in
order:

1. Runs `code-style` + `unit-tests` + `android-build` (4-ABI matrix).
2. Publishes a GitHub Release with all 4 APKs (`arm64-v8a`, `armeabi-v7a`,
   `x86_64`, `universal`). This job does **not** wait for the Gitee jobs.
3. Mirrors the repository to Gitee.
4. Creates a matching Gitee Release.
5. Uploads 3 ABI APKs to Gitee (`universal` is skipped due to Gitee's
   upload size limits).

### Beta Release

Same workflow, but with `vX.Y.Z.B-betaN` tags (e.g. `v1.3.0.156-beta1`). The
`.B` build-counter segment is required so the tag matches [Tag Naming](#tag-naming)
and stays compatible with `parseVersion` / Android update detection. The CI
auto-marks the release as pre-release when the tag name contains `beta`.

## Identifier Reference

| Field            | Value                      |
| ---------------- | -------------------------- |
| Android package  | `app.uniclipboard.android` |
| iOS bundle       | `app.uniclipboard.ios`     |
| App display name | `UniClip`                  |
| Expo slug        | `uniclip`                  |

These are independent namespaces from upstream. UniClip can be installed
alongside any other SyncClipboard-protocol client on the same device.
