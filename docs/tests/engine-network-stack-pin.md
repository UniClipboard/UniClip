# Engine pin after the network-stack submodule

Mobile moves the Engine pin from `5cbca8fc24a278fa7b01ae611bf4b925914bef13` (PR #230) to
`f44ae136f76a05e642fc22e32b823161f0716cef`, the Engine `main` tip on 2026-10-25. The module
label stays `v1.1.0-rc.23`; the full commit is authoritative.

## What the four Engine commits change

| Commit | Change | Effect on Mobile |
| --- | --- | --- |
| `17ae0b7b` (#233) | Pins the corrected EDNS parser through the iroh dependency chain | Runtime DNS behaviour |
| `1bf314a3` (#234) | The network stack moves into the git submodule `third_party/iroh` | Source preparation must populate the submodule |
| `76b12259` (#232), `f44ae136` (#265) | MBX snapshot and CI workflows | None on artifacts |

`bindings/`, `compatibility/` and the public contract are unchanged, so the generated Swift and
Kotlin files are byte-identical to the previous pin and no bridge or UI code changed.

## Failure model and the change

A worktree of a single fetched commit leaves `third_party/iroh` empty, so the Cargo build fails
deep inside dependency resolution. `scripts/engine-source-checkout.sh` now creates the worktree
for both `core:prepare` and the device install script, populates the submodules, and stops with
a message naming them if they cannot be fetched. The tests in
`scripts/__tests__/engine-source-checkout.test.mjs` were written first and failed before the
helper existed. They cover a populated submodule, an unreachable submodule, a commit without
submodules, and that both scripts use the helper.

## Verification (2026-10-24/25 UTC)

| Check | Result |
| --- | --- |
| `validate-unified-engine-core-source.mjs` | Exit 0 |
| `core:prepare` (iOS device, simulator, Android `arm64-v8a` + `x86_64`) and `core:verify` | Exit 0; submodule checked out at `4f388e14`; each native library embeds the pinned commit |
| Generated Swift and Kotlin | Same hashes as the previous pin |
| macOS binding E2E (`e2e/engine-settings/run.py`) | 7 of 7; runtime reports the pinned commit; only `Cargo.lock` differs in the compared source set |
| Swift module build (generic iOS Simulator) and Kotlin module compile | Pass |
| `tsc`, eslint, `npx jest` | 0 errors; 235 suites, 1960 tests |
| `node --test scripts/__tests__` | 46 pass; 3 fail identically on `main` (`engine-cache-tools.sh` missing in fixtures and a managed-iOS check) |

NOT RUN: simulators, devices, Maestro, cross-device transfer, Android release APK, full iOS app.
The Engine dependency audit (`crypto-bigint 0.5.5`, RUSTSEC-2026-0387) and MBX R2 jobs were not
re-checked against the new commit and are not waived.
