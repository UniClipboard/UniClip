---
name: ios-release
description: Build the iOS app locally with xcodebuild and upload it to App Store Connect for TestFlight alpha testing, without EAS. Use when the user asks to release, publish, or upload an iOS build, ship a TestFlight/alpha/beta build, or run "/ios-release". Handles build number bump, archive, export, upload, and the Homebrew rsync pitfall.
---

# iOS Local Release to TestFlight (no EAS)

Build locally and upload directly to App Store Connect. EAS cloud builds do NOT work
for iOS in this repo: the 293MB `modules/uc-core/ios/UniClipboardCore.xcframework` is
gitignored, so cloud builders never see it. Local build is the only supported path.

Working directory for all commands: `ios/` (the repo's prebuild output).

## Prerequisites (verify before building)

1. **Xcode signed in**: automatic signing and upload use the Apple ID logged into
   Xcode (team `8XG39X5CL8`). If signing fails, ask the user to check
   Xcode → Settings → Accounts.
2. **Pods in sync**: compare `ios/Podfile.lock` with `ios/Pods/Manifest.lock`.
   If they differ, run `pod install` in `ios/`.
3. **Native bindings fresh**: if `modules/uc-core` was rebuilt recently, confirm the
   xcframework and `modules/uc-core/ios/Bindings` come from the same rebuild
   (mismatch causes runtime crashes, not build errors).
4. **App Store Connect record exists** for bundle id `app.uniclipboard.UniClipboard`
   (it does — created for 1.1.0). Targets: main app + `.Share` + `.Keyboard`.

## Step 1 — Bump the build number

Every upload needs a `CFBundleVersion` unique within the marketing version.
Read the current value, increment it, and keep both files consistent:

- `ios/UniClip/Info.plist` → `CFBundleVersion` (what the archive actually uses)
- `app.json` → `expo.ios.buildNumber` (source of truth if a prebuild ever reruns;
  add the key if missing)

Bump the marketing version (`CFBundleShortVersionString` / `expo.version`) only when
the user says this is a new version, not just a new build.

## Step 2 — Archive

```bash
cd ios && xcodebuild -workspace UniClip.xcworkspace -scheme UniClip \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath build/UniClip.xcarchive archive -allowProvisioningUpdates
```

Takes 10–20 minutes — run it in the background. The archive being signed with an
"Apple Development" identity is normal; the export step re-signs for distribution.

Verify after success:

```bash
/usr/libexec/PlistBuddy -c "Print :ApplicationProperties:CFBundleVersion" \
  -c "Print :ApplicationProperties:CFBundleShortVersionString" \
  ios/build/UniClip.xcarchive/Info.plist
```

## Step 3 — Export and upload

`ios/build/ExportOptions.plist` should already exist (method `app-store-connect`,
destination `upload`, teamID `8XG39X5CL8`, automatic signing, uploadSymbols true,
manageAppVersionAndBuildNumber true). Recreate it with those values if missing.

**CRITICAL — Homebrew rsync pitfall**: `/opt/homebrew/bin/rsync` shadows the system
rsync and breaks Xcode's IPA packaging with a bare `error: exportArchive Copy failed`
(the real cause is only visible in the `.xcdistributionlogs` bundle named in the
output). Always prefix PATH with system directories:

```bash
cd ios && env PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH" xcodebuild -exportArchive \
  -archivePath build/UniClip.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist \
  -exportPath build/export -allowProvisioningUpdates
```

Run in the background (re-sign + upload takes a few minutes). Success looks like
`Upload succeeded` … `** EXPORT SUCCEEDED **`.

Expected non-blocking warnings: `Upload Symbols Failed … dSYM` for prebuilt
frameworks (React, hermesvm, SDWebImage, …). These only affect crash symbolication.

## Step 4 — Tell the user what to do in App Store Connect

The remaining steps are manual in https://appstoreconnect.apple.com → TestFlight:

1. Wait for processing (10–30 min; Apple emails when done).
2. Answer the export-compliance question on the new build (standard HTTPS is
   exempt). To skip this permanently, set
   `expo.ios.infoPlist.ITSAppUsesNonExemptEncryption: false` in `app.json`
   and re-prebuild.
3. Add the build to an **Internal Testing** group — no review needed; testers get
   the TestFlight invite immediately. External groups require a one-time Beta
   App Review.

## Troubleshooting

- `Copy failed` on export → Homebrew rsync (see Step 3); confirm with
  `grep -i rsync <logdir>/IDEDistributionPipeline.log`.
- Signing/provisioning errors → Xcode not signed in, or the account lacks an
  Apple Distribution certificate; `-allowProvisioningUpdates` creates one via
  cloud-managed signing once signed in.
- Upload rejected for duplicate build number → Step 1 was skipped; bump and redo
  Steps 2–3.
