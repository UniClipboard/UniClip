// Ported from UniClipboard/UniClipboard at 7e98b94b06364dd2b391a5b22c584bc7dea2d0a7.
// This module is loaded from the default branch for every privileged event.
const statusLabels = ['status:triage', 'status:in-progress', 'status:ready-for-test', 'status:verified'];
const releasePattern = /^v\d+\.\d+\.\d+\.[1-9]\d*(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const labelDetails = {
  'status:triage': ['ededed', 'Awaiting investigation'],
  'status:in-progress': ['fbca04', 'Implementation in progress'],
  'status:ready-for-test': ['0e8a16', 'Merged; awaiting release verification (may be unreleased)'],
  'status:verified': ['1d76db', 'Verified by an authorized collaborator in a named release'],
};
const labelName = (label) => typeof label === 'string' ? label : label.name;
const trustedComment = (comment) => comment.user?.login === 'github-actions[bot]' && comment.user?.type === 'Bot';
const hasMarker = (comments, marker) => comments.some((comment) => trustedComment(comment) && comment.body?.includes(marker));

function closingReferences(body = '') {
  return body.match(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:#\d+|[\w.-]+\/[\w.-]+#\d+|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)\b/gi) ?? [];
}

function issueReferences(body = '') {
  return [...new Set([...body.matchAll(/^[ \t]*(?:[-*][ \t]*)?(?:Related to|Refs)[ \t]+#([1-9]\d*)[ \t]*$/gim)].map((match) => Number(match[1])))];
}

async function run({ github, context, core }, action) {
  const repo = context.repo;
  const params = (number) => ({ ...repo, issue_number: number });
  const commentsFor = (number) => github.paginate(github.rest.issues.listComments, { ...params(number), per_page: 100 });
  const fail = (message) => core.setFailed(message);
  async function ensureLabels() {
    for (const [name, [color, description]] of Object.entries(labelDetails)) {
      try {
        await github.rest.issues.getLabel({ ...repo, name });
      } catch (error) {
        if (error.status !== 404) throw error;
        try {
          await github.rest.issues.createLabel({ ...repo, name, color, description });
        } catch (creationError) {
          // Another run may have created the label after our read. Only accept
          // that race when a subsequent read confirms the label now exists.
          if (creationError.status !== 422) throw creationError;
          await github.rest.issues.getLabel({ ...repo, name });
        }
      }
    }
  }
  async function setStatus(issue, status) {
    // Add first so an API failure never leaves the issue without a status.
    await github.rest.issues.addLabels({ ...params(issue.number), labels: [status] });
    for (const name of issue.labels.map(labelName)) {
      if (statusLabels.includes(name) && name !== status) {
        try {
          await github.rest.issues.removeLabel({ ...params(issue.number), name });
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
    }
  }

  if (action === 'validate') {
    const matches = closingReferences(context.payload.pull_request.body ?? '');
    if (matches.length) fail(`PR descriptions must not use GitHub closing keywords: ${matches.join(', ')}. Use dedicated "Related to #123" or "Refs #123" lines instead.`);
    return;
  }

  if (action === 'merge') {
    const pr = context.payload.pull_request;
    if (!pr.merged) return;
    const numbers = issueReferences(pr.body ?? '');
    if (!numbers.length) return;
    await ensureLabels();
    for (const number of numbers) {
      const { data: issue } = await github.rest.issues.get(params(number));
      if (issue.pull_request || issue.state !== 'open') {
        core.warning(`Skipping #${number}: only open issues enter release verification.`);
        continue;
      }
      const marker = `<!-- issue-lifecycle:merged-pr=${pr.number} -->`;
      if (hasMarker(await commentsFor(number), marker)) continue;
      await setStatus(issue, 'status:ready-for-test');
      await github.rest.issues.createComment({ ...params(number), body: [
        `PR #${pr.number} has merged. This issue is ready for release verification; the fix may not be released yet.`,
        marker,
      ].join('\n') });
    }
    return;
  }

  if (action === 'release') {
    const tag = context.eventName === 'release' ? context.payload.release.tag_name : context.payload.client_payload.tag_name;
    if (!releasePattern.test(tag ?? '')) return fail('Expected a mobile release tag such as v2.0.1.187-alpha.1.');
    // Never trust dispatch-provided URLs or accept unpublished/draft releases.
    const { data: release } = await github.rest.repos.getReleaseByTag({ ...repo, tag });
    if (release.draft || !release.published_at) return fail(`Release ${tag} is not published.`);
    const marker = `<!-- issue-lifecycle:verification-release=${tag} -->`;
    const issues = await github.paginate(github.rest.issues.listForRepo, { ...repo, state: 'open', labels: 'status:ready-for-test', per_page: 100 });
    const notified = [];
    for (const issue of issues) {
      if (issue.pull_request) continue;
      if (hasMarker(await commentsFor(issue.number), marker)) continue;
      await github.rest.issues.createComment({ ...params(issue.number), body: [
        `Release [${tag}](${release.html_url}) is available for verification.`,
        '',
        'This reminder does not prove the fix is included. Check the release contents and availability for the affected platform before testing.',
        `After verification passes, an authorized collaborator can comment \`/verify ${tag}\` to close this issue.`,
        marker,
      ].join('\n') });
      notified.push(`#${issue.number} ${issue.title}`);
    }
    await core.summary.addHeading(`Issues awaiting verification for ${tag}`).addList(notified.length ? notified : ['No new verification notices.']).write();
    return;
  }

  if (action === 'verify') {
    if (context.payload.issue.pull_request) return;
    const match = context.payload.comment.body.trim().match(/^\/verify\s+(\S+)$/);
    if (!match || !releasePattern.test(match[1])) return fail('Use the exact command /verify vX.Y.Z.BUILD (optionally with a prerelease suffix).');
    const tag = match[1];
    const username = context.payload.comment.user.login;
    const { data: permission } = await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username });
    // GitHub may expose triage/maintain in role_name with a legacy read/write permission.
    if (!['admin', 'maintain', 'write', 'triage'].some((role) => permission.permission === role || permission.role_name === role)) {
      return fail('Only repository collaborators with triage or higher permission can verify an issue.');
    }
    const number = context.payload.issue.number;
    const comments = await commentsFor(number);
    if (!hasMarker(comments, `<!-- issue-lifecycle:verification-release=${tag} -->`)) {
      return fail(`Issue #${number} was not requested for verification in ${tag}.`);
    }
    const { data: issue } = await github.rest.issues.get(params(number));
    const marker = `<!-- issue-lifecycle:verified-release=${tag} -->`;
    const recorded = hasMarker(comments, marker);
    if (issue.state === 'closed' && issue.labels.map(labelName).includes('status:verified') && recorded) return;
    // Allow a retry after labels/comment succeeded but closing failed.
    if (issue.state !== 'open' || !issue.labels.map(labelName).some((name) => name === 'status:ready-for-test' || name === 'status:verified')) {
      return fail('Only an open issue awaiting release verification can be verified.');
    }
    await ensureLabels();
    await setStatus(issue, 'status:verified');
    if (!recorded) await github.rest.issues.createComment({ ...params(number), body: [
      `Verified in ${tag} by @${username}.`, marker,
    ].join('\n') });
    await github.rest.issues.update({ ...params(number), state: 'closed', state_reason: 'completed' });
    return;
  }
  throw new Error(`Unknown lifecycle action: ${action}`);
}

module.exports = { run, closingReferences, issueReferences, releasePattern };
