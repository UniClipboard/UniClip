# CI validation and native build decisions

Automatic validation runs on pull requests and pushes to `main`. Feature-branch
pushes no longer start a second `build` run alongside `build-pr`. Open a PR to
validate a branch automatically, or use the existing manual build action.

| Event/change | Validation | Native compilation |
| --- | --- | --- |
| PR or main push: docs / known lifecycle and validation files only | Existing lint, type checks, app tests, lifecycle tests and CI policy tests | Not required; both existing native check names finish successfully on Ubuntu |
| PR or main push: app, dependency, Engine, Expo, native module, plugin, build workflow, or unknown path | Same validation | Android and unsigned iOS builds |
| Manual build/release | Existing validation and platform selection | Always build the selected platforms; path classification is bypassed |
| Feature-branch push without a PR | No automatic build workflow | Use a PR or the manual action |

The allowlist in `scripts/ci-changes.mjs` is intentionally small: `docs/`, selected
root documentation, lifecycle files, and known validation/publishing-only
workflows. It does not exclude all `.github/` or all scripts. Native build
workflows, the classifier and its own tests require builds. Unknown paths also
require builds. Changes to app source build both platforms conservatively; this
policy does not try to infer platform-specific dependency graphs.

## Diff boundaries and failures

PRs use the merge-base comparison of the event's base and head SHAs (`base...head`),
so unrelated work on the target branch does not make a docs-only PR native.
Main pushes compare the event's complete before/after range (`before..after`), not
only the last commit. Rename detection is disabled so both old and new paths are
classified; deletions count too. File names are NUL-delimited and Git arguments are
passed without a shell.

Checkout supplies full history. Invalid event data, missing commits (including
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
second partial-test policy. The initial optimization PR itself changes build
workflows and therefore runs native checks.

## Tests

```sh
node --test scripts/tests/ci-changes.test.mjs scripts/tests/ci-workflows.test.mjs
```

Tests exercise real temporary Git histories and the actual workflow conditions
and completion scripts, including manual platform selection, failures, missing
outputs, and stable check names. They never run native builds or call live APIs.
The reusable unit-test workflow runs these alongside lifecycle and app tests.
