# Mobile issue verification lifecycle

UniClip uses the desktop lifecycle from UniClipboard/UniClipboard (source reviewed
at `7e98b94b06364dd2b391a5b22c584bc7dea2d0a7`), adapted to mobile release tags and
publishing. Issues remain open after a fix merges, until someone verifies it.

```text
status:triage -> status:in-progress -> status:ready-for-test -> status:verified -> closed
```

- Maintainers set `status:triage` during investigation and `status:in-progress`
  when development starts. These are manual transitions, as on desktop. Remove
  the previous lifecycle status when changing it; keep other labels.
- A merged PR marks its linked open issues `status:ready-for-test` and records the
  PR number. **Ready for test includes merged fixes that are not released yet.**
  No release or successful device test is implied, and merging does not close the
  issue. Closed issues and references to PRs are skipped, never reopened.
- A published GitHub Release adds a version-specific verification notice to every
  open issue currently labeled `status:ready-for-test`, including alpha releases.
  Notices leave the issue status unchanged.
- After testing, a collaborator with triage, write, maintain or admin permission
  comments `/verify VERSION`. A matching workflow-authored release notice and an
  open issue awaiting verification are required. The workflow records who verified
  which release, changes the status to `status:verified`, and closes as completed.

## Link PRs without automatic closure

Use dedicated lines in the PR description, one issue per line:

```markdown
## Related Issues

Related to #123
Refs #456
```

Optional `-` or `*` bullets and case differences are accepted. Inline mentions,
multiple references on one line, cross-repository references, and trailing prose
are not lifecycle links. Duplicate references are processed once.

Do not use GitHub's closing keywords (`close`, `closes`, `closed`, `fix`, `fixes`,
`fixed`, `resolve`, `resolves`, `resolved`) before an issue reference. The
**Issue lifecycle / Validate issue references** check rejects those forms,
including repository-qualified references and issue URLs. The validator does not
require every PR to reference an issue. No additional PR template is installed.

## Verify the mobile build

Use the full tag, including all four numeric components and any prerelease suffix:

```text
/verify v2.0.1.187-alpha.1
```

`v2.0.1.187` and legacy `v2.0.1.187-beta1` tags are also supported; desktop
three-component tags such as `v2.0.1` are not. The fourth component must be a
positive build number. The comment must contain only the command and version.
Run this only after verifying the affected behavior on the relevant Android/iOS
build. Add device/platform and test details in a separate comment when useful.

## Release integration and limits

`release.yml` dispatches `issue-lifecycle-release` immediately after successful
GitHub publication for every platform selection and channel. This is necessary
because publication using `GITHUB_TOKEN` does not trigger another workflow's
`release` event. Manually published releases also use `release: published`.
The lifecycle fetches the real published release by tag; dispatch payloads cannot
supply an arbitrary release URL or a draft release. A repeated publish/dispatch
uses the same version marker and does not post the notice again.

The existing GitHub, TestFlight and FlareRelease jobs, artifact handling and
signing are preserved. The notice follows **GitHub publication**, not completion
of TestFlight processing or FlareRelease channel promotion. An iOS-only release
may have no Android assets; an Android-only release has no new TestFlight build.
TestFlight upload/processing and FlareRelease registration may still be pending
or fail independently. Check the affected platform's actual availability.

Inherited limits from the desktop model:

- A release reminder is broadcast to all currently ready issues. It **does not
  prove that the release tag contains the merged fix**, compare commits, or map
  issues to release platforms. The human verifier must establish inclusion and
  test the correct build before closing; a notice is only a prerequisite.
- Notices are not automatically backfilled when an issue becomes ready after a
  release. Old notices remain on the timeline when an issue re-enters testing;
  they are not bound to a particular fix attempt. Check the latest fix manually.
- The reference check examines the PR body, not every possible GitHub closure
  source (for example commit messages). Avoid closing keywords there too.
- API mutations are not transactional. Review failed Actions runs and rerun as
  needed. Per-release/issue/PR concurrency coalesces duplicate events, but does not
  serialize every different event affecting the same issue. GitHub can replace a
  pending run in a concurrency group; it is not a durable event queue.

Mobile safeguards additionally require workflow-authored markers from
`github-actions[bot]`, use current collaborator permissions, preserve unrelated
labels, deduplicate merge/verification records, and allow retries after partial
verification failures. Privileged events load only default-branch code. A
closed-only `pull_request_target` event supports fork PR merges without executing
the fork's code with a write token. Do not replace this checkout with the PR head.

## Setup after merge

1. The workflow must land on the default branch before release, issue-comment and
   dispatch events can use it. No new secrets or signing changes are required.
2. Missing lifecycle labels are created lazily by the first linked merge or
   successful verification. Existing label definitions are never overwritten.
   If maintainers need `status:in-progress` before that, create the four labels
   manually using the definitions in `.github/scripts/issue-lifecycle.cjs`.
   This PR does not create live labels or migrate existing issues.
3. A maintainer should make **Issue lifecycle / Validate issue references** a
   required check in the repository ruleset/branch protection to enforce it.
   Merely adding a workflow does not prevent merging a failing check. This PR
   does not change repository security settings.
4. Existing merged fixes need a separate manual status review: events are not
   replayed for old PRs. In particular, issue #20 / merged PR #52 remains a separate
   pending status update; no live issue state or merged PR is edited by this PR.
5. A failed notification dispatch makes the GitHub publication job fail after the
   release exists; inspect the error and rerun that job. Existing `allowUpdates`
   behavior and per-version notice deduplication make this safe for the lifecycle.

## Local validation

```sh
npm ci
node --test scripts/tests/issue-lifecycle.test.mjs
```

The reusable test workflow runs these tests on PRs and builds. They execute the
actual lifecycle module with mocked GitHub APIs and parse the workflow entrypoints
and release wiring. No test creates live labels, verifies/closes live issues, or
publishes a release.
