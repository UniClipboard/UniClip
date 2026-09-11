# Mobile E2E (Maestro)

Runs the real bundled App on a fresh, disposable simulator/emulator **for every scenario**.
No database injection, preview screens, Metro server, or physical-device reset.

## Requirements

- Node from `.nvmrc`, Java 17+, Maestro **2.10.0**.
- iOS: macOS, Xcode, iOS **26.3** runtime, iPhone **17 Pro** device type.
- Android: SDK command-line tools, platform-tools, emulator and
  `system-images;android-36;google_apis;arm64-v8a` (first supported host is Apple Silicon).
  Set `ANDROID_HOME` if the SDK is outside `~/Library/Android/sdk`.
- A current, independently runnable Release Simulator `.app` or arm64 `.apk`.

Install the official `cli-2.10.0/maestro.zip` from
[Maestro releases](https://github.com/mobile-dev-inc/Maestro/releases/tag/cli-2.10.0).
SHA-256: `29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991`.
Extract under `~/.local/share/mobile-e2e/2.10.0/` and make `maestro/bin/maestro`
executable, or set `MAESTRO_BIN` to your installed executable. The entry point verifies
its version. CLI analytics and update checks are disabled for test runs.

## Build

Reuse the project's Engine preparation, Expo prebuild and CocoaPods setup. Do not run
`install:dev` for E2E: that command targets physical development devices.
For an already prepared development checkout:

```sh
APP_VARIANT=development xcodebuild build \
  -workspace ios/UniClipDev.xcworkspace -scheme UniClipDev \
  -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/uniclip-e2e-ios \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES
```

From `android/`:

```sh
APP_VARIANT=development ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

If a different variant was prebuilt, use its actual workspace/scheme. Do not disable
Engine verification to get a build through. The test entry point reads the installed
application identifier from the provided artifact; no production identifier is hardcoded.
Simulator builds must preserve App Group entitlements through ad-hoc signing. An unsigned
build can launch but fail to access shared settings; the entry point rejects it before
creating a device. No distribution certificate is needed for this simulator signature.

## Run

```sh
npm run test:e2e -- --platform ios --app /tmp/uniclip-e2e-ios/Build/Products/Release-iphonesimulator/UniClipDev.app
npm run test:e2e -- --platform android --app /absolute/path/to/app-arm64-v8a-release.apk
npm run test:e2e -- --platform ios --app /path/to/UniClipDev.app --scenario first-launch
npm run test:e2e -- --platform ios --app /path/to/UniClipDev.app --repeat 3
npm run test:e2e:environment
```

`--scenario <name>` selects an independent scenario. Available scenarios:

| Scenario | Coverage |
| --- | --- |
| `first-launch` | Onboarding and persistence across restart |
| `settings-navigation` | Storage row trailing-space tap and return home |
| `history-text-lifecycle` | Real clipboard capture, deduplication, preview, cancellation on Android, deletion and restart |
| `history-search-filter` | Text and URL capture, query replacement, no results, clearing and type filters |

 Omitting the
option discovers only `.maestro/scenarios/*.yaml`. Repetitions are limited to 1–7. Android also checks the total selected scenarios × repeat against its 15 unique transport pairs before creating any devices; the four-scenario suite supports up to three rounds if enough pairs are available. A suite is run serially with a new
device for each scenario, including each repetition. Calling Maestro directly is useful
for debugging but does not provide the environment isolation of this entry point.

## Ownership

- `.maestro/scenarios`: user intent and explicit result checks.
- `.maestro/actions`: reusable actions; platform branches only where behavior differs.
- `.maestro/assertions`: visible application results.
- `.maestro/lifecycle`: launch/restart without resetting persisted data. Initial launch assumes a freshly installed app; restart explicitly stops once. Both launch steps disable Maestro's redundant automatic stop.
- `e2e/environment`: prepare owned device, run Maestro, collect evidence, dispose.
  It must not implement clicks or interpret flow commands.

Native identifiers are forwarded by the existing AppButton, SettingsNavRow and Android
settings row. Keep shared controls reusable. Never target a child label and claim that
it proves full-row interaction.

The storage test taps **85% across the identified row**, not 85% across the screen.
Inspect `storage-row-before-tap.png` to verify the point remains in empty space if the
layout changes. English and light appearance are fixed where configured; localized
content assertions are intentionally scoped to this test locale. Android Wi-Fi is disabled and airplane mode enabled after installation: these local-only scenarios must not depend on
remote release announcements. The entry point waits for consecutive successful boot, initial provisioning and airplane-mode checks before handing the device to Maestro. ADB remains available. Network scenarios will require a
separate explicit environment policy.

## Results and failure handling

`e2e/results/<run>/summary.json` records artifact identity, source revision, tool/device
versions, stage and errors. Each scenario has its own Maestro report/logs, screenshot,
UI hierarchy and device logs. The original failure is retained if evidence or cleanup
also fails. Missing hierarchy is recorded explicitly; check evidence completeness.
The entry point exits nonzero for failures or interruption. It never retries a failed
business flow automatically.

Owned devices are disposed after capture, including partially failed preparation. Android
transport port pairs are not reused within a run, even after a prior emulator exits.
Only the emulator-recommended even console ports 5556–5584 are used (5554 is left
for normal development); unavailable pairs are skipped.
SIGINT/SIGTERM interrupts Maestro and allows cleanup; SIGKILL/machine failure cannot
run cleanup. For recovery, inspect the exact `uniclip-e2e-*` simulator or the run's AVD
before deleting it. Never use bulk device erasure. Device names/IDs are not accepted as
inputs, so existing personal simulators and AVDs cannot be selected accidentally.

## Acceptance

Run each scenario independently on both platforms, then both together for three rounds.
To test the failure path, temporarily change a final assertion to a nonexistent visible
label, run the scenario, verify nonzero exit, report + screenshot + hierarchy and device
cleanup, then restore the assertion. Do not commit the deliberate failure.

The framework is not accepted until those runs are recorded. UI navigation success does
not establish cross-device sync, background behavior, or frame-by-frame animation quality.
Automatic CI execution is added only after local dual-platform acceptance; use these same
commands, retaining evidence and an unconditional cleanup step on the dedicated runner.

## History fixture ownership

History scenarios type fixture text into the existing search field, use the native selection menu and **Copy**, then close search. This exercises the actual OS clipboard observer and history writes. Maestro `setClipboard` only sets internal test memory and `pasteText` types that memory; neither is a substitute for setting the OS clipboard in these tests. See the [Maestro clipboard documentation](https://docs.maestro.dev/reference/commands-available/setclipboard) and [pinned command implementation](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.10.0/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt).

Search, selection/copy, context actions, filters and history assertions remain reusable subflows. A card tap copies; phone content preview is opened by long press. iOS deletion is immediate, while Android additionally checks cancellation and confirmation. No artificial phone detail route or database seed is introduced. Fixture links use the reserved `example.invalid` domain.
