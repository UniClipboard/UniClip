# Engine rc.14 mobile adaptation, 2026-09-08

## Source

- Previous pin: `v1.1.0-rc.6`, `1631a370399ebcd0821b2163ca3594d63fad3451`.
- Target: `168a3ebd7c2701f2e9f8a0ebe0c4a0af4aa14543`, `v1.1.0-rc.14`.
- The final pin uses published release artifacts and their verified manifest.
  GitHub main and the local Engine checkout agree on this commit.
- Compared with `271d2e1d`, rc.14 changes workspace versions and release evidence,
  with no additional mobile runtime or contract changes.

## Adaptation

- The existing six-digit invitation input already matches Engine's `XXX-XXX`
  format, including leading zeros.
- Parse candidate member names, sources, structured reasons, and explicit impact.
- Use Engine impact for sync scope, paused peers, pending confirmations,
  required invitations, and local removal confirmation. Do not infer an impact
  when Engine explicitly returns null. Retain rc.6 field compatibility.
- Both native choice views show localized explanations and pending confirmations.
  Extend the existing preview scenario without touching real Space state.
- UniFFI public method signatures are unchanged; the added fields travel through
  the existing JSON response. The updated native libraries include
  membership recovery, admission responsiveness, and Android file-lease fixes.
- The local-development fallback builds the pinned source in `/tmp` with an
  isolated Cargo home, sharing only downloaded dependency caches. A fixture
  regression test exercises this path.
- The fallback also preserves the pinned iOS archive and binding in the version
  cache so the existing device-install command can restore them afterward.

## Verification

- TypeScript check: passed. Repository lint: zero errors, 305 existing warnings;
  focused lint of changed application files: passed without warnings.
- Native preparation/verification fixture tests: 2 passed.
- Release verification: `core:prepare`, `core:verify`, and source validation
  against the downloaded rc.14 manifest passed. Both platforms use published
  artifacts. Swift and Kotlin bindings are byte-identical to rc.6.
- iOS app: Debug simulator build, including Share and Keyboard targets, passed
  with normal simulated entitlements. Installed and launched on iPhone 17 Pro,
  iOS 26.3. The unsigned build is not used as storage-compatibility evidence.
- iOS UI: real preview opened; localized reasons rendered; tapping the empty
  trailing area selected each choice; pending confirmation text remained readable
  after scrolling; exit review, Back, and final preview confirmation all worked.
  Screenshots: `/tmp/mobile-engine-ios-choice.png`,
  `/tmp/mobile-engine-ios-pending.png`, `/tmp/mobile-engine-ios-confirm.png`.
- Android Engine: the published AAR includes arm64-v8a and x86_64.
- Android app: `:app:assembleDebug` passed, APK installed with `adb install -r`
  on the connected Android 15 phone, and the app launched successfully. Existing
  history and image thumbnails remained visible. After the Android packaging
  strip step, the APK Engine library is byte-identical to the pinned AAR library.
- Android native tests: the physical phone rejected installation of the separate
  test APK (`INSTALL_FAILED_USER_RESTRICTED`). Re-ran on the existing
  `UniClip_API_36` emulator with `ANDROID_SERIAL`; all 19 tests passed, including
  the final run against rc.14. The emulator was shut down afterward.
- Android UI: real preview shows localized reasons and pending confirmations;
  empty trailing row space selects both options; exit review, Back, and final
  preview confirmation work. Screenshots: `/tmp/mobile-engine-android-choice.png`
  and `/tmp/mobile-engine-android-confirm.png`.
- The detailed UI preview checks used the functionally identical `271d2e1d`
  runtime. After rc.14 adoption, both apps were rebuilt, installed, and launched
  again; their application-side UI code is unchanged.
- Final rc.14 Jest suite, excluding generated `.artifacts` from module discovery:
  1256 tests passed; 3 baseline failures remain (171 suites passed, 3 failed).
  The pin check passed against the published rc.14 metadata.

The following tests also fail on the untouched starting commit `87f8296`:

- `installDevDeviceScript.test.ts`: pinned iOS restoration source assertion.
- `relaySettings.test.ts`: iOS add-relay row source assertion.
- `DeveloperPage.deviceTrustPreview.test.ts`: DeveloperPage source assertion.

These are baseline failures, not evidence of a successful full test suite.
Preview checks cannot prove real device-group convergence or preservation during
an upgrade of the production app. No production data is cleared by this work.
