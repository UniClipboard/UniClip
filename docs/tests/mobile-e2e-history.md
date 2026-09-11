# History E2E coverage validation

Date: 2026-09-11. Framework base committed as `92d3acd`; this report covers the subsequent working-tree expansion.

## Coverage

| Scenario | Actual user path |
| --- | --- |
| history-text-lifecycle | System Copy from the real search input → one history card → copy same content again → restart with one retained card → long-press content preview → cancel deletion on Android → delete → restart with no record |
| history-search-filter | Copy plain text and URL → two cards → matching search → replace with a missing query → no matches → close search → two cards → Text filter → Link filter → restore All |

Fixtures use native Copy, never database writes or Maestro internal clipboard memory. iOS selects text with double tap; Android uses long press. Search replacement uses the real clear button. This covers local in-app system-copy capture, not cross-app paste permission prompts, background restrictions, file/image imports or cross-device sync.

## Artifacts

- iOS: app.uniclipboard.UniClipboard.dev, 2.0.0 (180), signed Simulator Release build.
- UniClipDev SHA-256: `4dab9eefb0183014e1610e9b59b98a149e30db474e76eb36dbb50bf99d05b895`.
- main.jsbundle SHA-256: `ecc3aa6a69df25f118718a879b91c0639888d4ea3e501b54a6d100e315980ff6`.
- app-arm64-v8a-release.apk SHA-256: `04f285e9d91b9201d2fc4e528eeca5864bd6eee09455355c7a642cb6f0865f94`.

## Verification

- Both history scenarios passed individual runs on iOS and Android. The initial iOS long-link copy trial correctly failed; changing iOS selection to double tap fixed the test action.
- Final iOS expanded suite: 4/4 passed; `e2e/results/2026-09-11T05-10-57.522Z-ios-55117`. All reports executed one unskipped case without failure/error, evidence files are nonempty, and all owned devices were verified removed.
- Final Android expanded suite: 4/4 passed; `e2e/results/2026-09-11T05-11-03.360Z-android-55168`. All reports executed one unskipped case without failure/error; evidence and unique-device cleanup were verified, including removal of each owned AVD directory.
- Portable framework checks: 15 passed, including nested flow references, real system Copy usage, restart assertions and expanded-suite capacity validation and exactly-once restart termination.
- A real APK run with four scenarios × four repeats was rejected before device creation, as expected.
- Affected UI tests: 22 passed; TypeScript checks passed; focused lint has no errors (existing UI warnings remain).

Actual emulator E2E remains local. The existing CI workflow continues to run the portable framework checks.

## Integration observations

One early combined run missed iOS clipboard capture. A dedicated fresh-device investigation confirmed an empty initial clipboard, real `CedarAlpha` after Copy, and exposed the first-use QuickPath keyboard guide. The search-open action now dismisses that guide when shown, and the clipboard action saves the actual selection before Copy. The investigation device was cleaned and its temporary entry point removed.

An early Android combined run reported a transport failure during the automatic force-stop before first launch. Fresh devices do not need that redundant stop; initial launch now explicitly uses `stopApp: false`. Restart still explicitly stops the app once before launching, preserving the persistence checks. Earlier failures are retained; final combined reruns determine acceptance.

## Final outcome

The suite grew from two to four scenarios. The final combined run passed all four on each platform (8/8), after the individual scenario runs. Both platform preview screenshots were inspected: the exact text is visible and the Delete action belongs to the full menu row. All evidence files are present and all eight owned devices were confirmed removed. This coverage is a separate increment after framework commit `92d3acd`.
