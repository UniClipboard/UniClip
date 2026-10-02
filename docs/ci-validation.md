# CI validation and native build decisions

Automatic validation runs on pull requests and pushes to `main`. Feature-branch
pushes no longer start a second `build` run alongside `build-pr`. Open a PR to
validate a branch automatically, or use the existing manual build action.

| Event/change | Validation | Native compilation |
| --- | --- | --- |
| PR or main push: docs / lifecycle / validation / scheduling-only changes | Existing lint, type checks, app tests, lifecycle tests and CI policy tests | Not required; both existing native check names finish successfully on Ubuntu |
| PR or main push: app, dependency, Engine, Expo, native module, plugin, native build recipe, or unknown change | Same validation | Android and unsigned iOS builds |
| Manual build/release | Existing validation and platform selection | Always build the selected platforms; path classification is bypassed |
| Feature-branch push without a PR | No automatic build workflow | Use a PR or the manual action |

The allowlist in `scripts/ci-changes.mjs` covers `docs/`, selected root documentation,
lifecycle files, known validation workflows, and the classifier
and its tests. It does not exclude all `.github/` or all scripts. Unknown paths
require builds. Changes to app source build both platforms conservatively; this
policy does not try to infer platform-specific dependency graphs.

Build workflow files receive a **content comparison**, not a path exemption.
`scripts/ci-native-recipes.mjs` parses their before/after YAML and removes only the
recognized scheduling fields: automatic triggers, caller dependencies/conditions,
classifier wiring, and the exact native-check completion wrapper. It then compares
all remaining recipe fields. In the release workflow, only the exact lifecycle
notification dispatch can be ignored; all publishing and artifact settings stay
compared. Changes to native commands, actions/toolchains,
runners, environment/secrets, cache, outputs, artifacts, signing or manual/release
jobs still require compilation. The classifier workflow itself must have the
known checkout, Node setup, script-free dependency install, and classification
steps; additional jobs or commands are not accepted as scheduling-only.

Unrecognized wrapper structures, malformed YAML, and unavailable snapshots request
native builds. This bounded normalization deliberately prefers extra builds over
ignoring a new execution mechanism. A future scheduling-wrapper redesign may need
an explicit policy/test update. It avoids splitting or renaming the existing native
build implementations merely to change scheduling.

## Diff boundaries and failures

PRs use the merge-base comparison of the event's base and head SHAs (`base...head`),
so unrelated work on the target branch does not make a docs-only PR native.
Main pushes compare the event's complete before/after range (`before..after`), not
only the last commit. Rename detection is disabled so both old and new paths are
classified; deletions count too. File names are NUL-delimited and Git arguments are
passed without a shell.

Classification checkout supplies full history and installs the locked YAML parser with
`npm ci --ignore-scripts`, so the classifier does not compile native dependencies. Invalid event data, missing commits (including
force-push boundaries), oversized diffs, and Git failures conservatively request
both builds. Failure of the classifier job itself or its output writing is not
accepted as a successful no-build decision. Only an explicit `false` output from
a successful classification can avoid compilation.

## Required checks remain present

There are no workflow-level path filters. The existing native check contexts stay:

- `android-build / Build Release APK`
- `ios-build-check / Build iOS app and extensions`

Their caller jobs use `always()` so failed or skipped dependencies still produce
an explicit failed check rather than silently passing. The reusable workflows
first check whether upstream validation succeeded. If it did and compilation is
unnecessary, they record the reason in the run summary and skip all native steps.
The iOS no-build path uses Ubuntu, not a macOS runner. If a build is necessary,
the existing setup, Engine, compilation and artifact steps run unchanged.

No branch-protection changes or new required-check names are needed for this
optimization. Normal GitHub cancellation/runner outages can still interrupt jobs;
this policy addresses checks missing because an entire workflow was path-filtered.
The existing issue-reference check remains independent.

## Manual release behavior and tradeoffs

Manual Android/iOS/both selection, signed iOS builds, TestFlight, release tag
validation/creation, GitHub publication, FlareRelease, and signing settings are
unchanged. Automatic validation cannot publish a release. `main` still validates
native-affecting changes after merge, even when the PR was already validated;
this intentionally preserves integration verification. The eliminated duplicate
is the feature-branch push run alongside the PR run.

Lint and the full existing unit suite still run for docs-only changes. This keeps
the optimization focused on the expensive native builds without creating a
second partial-test policy. Scheduling-only edits to the build workflows—including this optimization—take the
lightweight completion path when the comparison proves their native recipes unchanged.

## Tests

```sh
node --test scripts/tests/ci-changes.test.mjs scripts/tests/ci-workflows.test.mjs scripts/tests/ci-native-recipes.test.mjs
```

Tests exercise real temporary Git histories and the actual workflow conditions
and completion scripts, including manual platform selection, failures, missing
outputs, and stable check names. They never run native builds or call live APIs.
The reusable unit-test workflow runs these alongside lifecycle and app tests.
