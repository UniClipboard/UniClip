# React Doctor top-three review, 2026-09-08

## Scope and result

Reviewed only the three requested rules. No rule was disabled, ignored, or suppressed.
The requested occurrences have no `fixGroupId`; other diagnostics do have groups and were left untouched.

`npx react-doctor@latest --verbose` scanned 694 files before and after:

| Rule | Before | After | Decision |
| --- | ---: | ---: | --- |
| build-pipeline-secret-boundary | 5 | 0 | Confirmed signing/upload exposure fixed; analytics scope hardened |
| no-barrel-import | 1 | 1 | Observation: trial did not improve the production bundle; reverted |
| prefer-module-scope-static-value | 5 | 0 | Confirmed read-only literals moved outside render |
| All other rules | 194 | 194 | Deferred unchanged |

Total: 205 to 195 diagnostics. Final score: 66/100. Remaining categories: Bugs 5 errors and 119 warnings; Performance 36 warnings; Maintainability 35 warnings.

## Canonical recipes and applicability

Fetched the following pages and their canonical Markdown recipes using curl with both `Cache-Control: no-cache` and `Pragma: no-cache`:

- https://react.doctor/docs/rules/react-doctor/build-pipeline-secret-boundary
- https://react.doctor/docs/rules/react-doctor/no-barrel-import
- https://react.doctor/docs/rules/react-doctor/prefer-module-scope-static-value

Also read the Expo 56 versioned reference before editing application code.

### Build/install boundary

The detector matches nearby text, not actual environment inheritance. The reported adoption quality-job line is adjacent to another job's analytics setting: that exact cross-job match is a false positive. Its Android/iOS jobs nevertheless inherited the analytics key during installation.

- `release.yml`: confirmed exposure. Wrangler was installed without a lock in the same step that held Cloudflare upload credentials. Install a locked, pinned tool in a separate step with scripts disabled; expose upload credentials only to the upload step.
- `build-ios.yml`: confirmed exposure. The App Store Connect private key was written to disk before npm installation. Move key/profile setup after npm, project preparation, Expo prebuild, and CocoaPods installation. This delays signing preflight but still checks it before archive.
- `android-build.yml`, `ios-build-check.yml`, and adoption platform jobs: the PostHog project key is embedded into native application metadata by `plugins/withPostHogAnalytics.ts`. It is a client-distributed identifier, not an account administration credential. Narrow it to Expo prebuild, which writes that metadata. Do not claim its previous availability proves account compromise.
- App installations use the existing lock with scripts disabled. Explicitly run the repository's patches and workspace prepare scripts without secrets. The adoption quality job also rebuilds its SQLite test dependency without secrets. This preserves required generated modules and tests.

Hosted runners remain in use. This change does not claim to sandbox all build tools, nor to remove the signing authority required by the existing Xcode archive/export process. No evidence of an actual credential leak was found or asserted.

### Barrel import

Confirmed that `src/stores/index.ts` is a re-export-only entry point. Tested replacing the two imports with their defining store files, then built the same iOS production export with source maps:

| Metric | Original | Direct-import trial |
| --- | ---: | ---: |
| Hermes bundle bytes | 11,752,688 | 11,752,712 |
| Source map sources | 3,859 | 3,859 |

The store entry point remained reachable through other callers. React Doctor reports at most one barrel per importing file; after the trial its warning moved to the observability import. That API and other feature APIs intentionally expose public entry points; `eslint.config.mjs` explicitly directs consumers away from internal implementations.

Per the recipe's requirement to keep a performance correction only with measured benefit, reverted the trial and its test adjustments. `App.tsx` is unchanged. This is not a suppressed warning or a claim that every barrel is free. A future startup investigation needs a measured loading problem before changing these boundaries.

### Static values

Confirmed all five literals are read-only and have no component-local captures or mutation through aliases. No React Compiler setting is enabled in this project.

- `App.web.tsx`: theme choices, filter labels, and tonal palette descriptors.
- `SpaceDeviceDetail.android.tsx` and `SpaceDeviceDetail.ios.tsx`: device fact keys.

Each now exists once outside its component. Current theme colors, translation lookup, selected values, and device values are still evaluated during rendering. Existing platform-specific UI and shared controls are preserved. These are small allocation cleanups; no measured user-visible speedup is claimed.

## Validation

- React Doctor rerun after each rule decision. Final diagnostics only remove the two fixed rules; all other rule counts are unchanged.
- Five workflow regression checks pass, covering disabled install scripts, inherited environment, signing-key ordering, and explicit project preparation. Included in the existing release workflow test suite.
- Fresh temporary installation with `npm ci --ignore-scripts` passes under the project's Node 22.22.1. Project patches pass; all seven workspace prepare scripts generate their entry files; rebuilt SQLite executes an in-memory query successfully.
- Locked Wrangler install with scripts disabled passes; the actual R2 upload command's help confirms existing flags. A local R2 upload/download round trip returns byte-identical content.
- TypeScript passes. Focused ESLint has zero errors and 47 existing warnings in the web preview.
- Focused app startup, release workflow, and device-detail tests pass. Full-suite attempt has 177 passing suites and 3 failures in untouched areas: `installDevDeviceScript.test.ts`, `relaySettings.test.ts`, and `DeveloperPage.deviceTrustPreview.test.ts`. The pre-existing local Engine artifact tree also causes Jest obsolete-snapshot noise; focused reruns excluding that tree pass cleanly.
- iOS production exports used for the import comparison pass. Final web export passes. Chrome desktop (1280x900) and mobile (390x844) checks exercise light/dark theme changes and filter selection; color values change and no page errors occur. Screenshots inspected.
- No signed archive, remote CI run, TestFlight upload, or production R2 upload was performed. Native device/simulator interactions were not exercised.

## Follow-up

Do not treat the remaining warnings as confirmed product defects without each rule's false-positive checks. Prioritize the five error-level render mutations, including one in a test file. Then review state/effect behavior and loading/error handling before broad performance cleanup.

Largest remaining groups:

| Candidate area | Diagnostics |
| --- | ---: |
| Platform shadow styles | 27 |
| Sequential work in loops | 20 |
| Complex React functions | 19 |
| State adjustment after changed inputs | 18 |
| Shadow presentation preference | 16 |
| Array index keys | 16 |

Shadow categories can overlap; preserve `fixGroupId` grouping when planning the next pass. There are also 8 image-component suggestions, 8 chained iterations, 7 dependency warnings, 6 duplicated UI occurrences, and smaller groups. The full remaining diagnostic list is in:

`/var/folders/qg/rry799n942993tzkb97j637w0000gn/T/react-doctor-84fc311d-c690-429b-856a-79774113b661/diagnostics.json`
