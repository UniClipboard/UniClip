import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import lifecycle from '../../.github/scripts/issue-lifecycle.cjs';

const { run, closingReferences, issueReferences, releasePattern } = lifecycle;
const tag = 'v2.0.1.187-alpha.1';
const bot = { login: 'github-actions[bot]', type: 'Bot' };
const notice = (version = tag, user = bot) => ({ user, body: `<!-- issue-lifecycle:verification-release=${version} -->` });
const workflow = parse(readFileSync(new URL('../../.github/workflows/issue-lifecycle.yml', import.meta.url), 'utf8'));

function fixture() {
  const calls = [];
  const failures = [];
  const issue = { number: 20, title: 'Example issue', state: 'open', labels: ['bug', { name: 'status:in-progress' }] };
  const comments = [];
  const labels = new Set(['status:triage']);
  const state = { issue, comments, labels, permission: { permission: 'write' }, release: { tag_name: tag, html_url: `https://github.com/UniClipboard/UniClip/releases/tag/${tag}`, published_at: '2026-10-02', draft: false } };
  const method = (name, fn = () => ({})) => async (args) => { calls.push([name, args]); return fn(args); };
  const github = { rest: { issues: {
    get: method('get', () => ({ data: structuredClone(issue) })),
    getLabel: method('getLabel', ({ name }) => { if (!labels.has(name)) throw Object.assign(new Error('missing'), { status: 404 }); return {}; }),
    createLabel: method('createLabel', ({ name }) => { labels.add(name); }),
    addLabels: method('addLabels', ({ labels: added }) => { issue.labels.push(...added.filter((name) => !issue.labels.some((label) => (label.name ?? label) === name))); }),
    removeLabel: method('removeLabel', ({ name }) => { issue.labels = issue.labels.filter((label) => (label.name ?? label) !== name); }),
    createComment: method('createComment', ({ body }) => { comments.push({ body, user: bot }); }),
    update: method('update', (args) => { issue.state = args.state; }),
    listComments: 'comments', listForRepo: 'issues',
  }, repos: {
    getReleaseByTag: method('getReleaseByTag', () => ({ data: state.release })),
    getCollaboratorPermissionLevel: method('permission', () => ({ data: state.permission })),
  } }, paginate: async (endpoint, args) => {
    calls.push(['paginate', args]);
    return endpoint === 'comments' ? comments : [issue, { number: 99, pull_request: {} }];
  } };
  const core = { setFailed: (message) => failures.push(message), warning() {}, summary: { addHeading() { return this; }, addList() { return this; }, async write() {} } };
  const context = { repo: { owner: 'UniClipboard', repo: 'UniClip' }, eventName: 'repository_dispatch', payload: {
    pull_request: { number: 52, merged: true, body: 'Related to #20\nRefs #20' },
    issue: { number: 20 }, comment: { body: `/verify ${tag}`, user: { login: 'tester' } }, client_payload: { tag_name: tag, html_url: 'https://untrusted.invalid' },
  } };
  return { state, calls, failures, context, github, core, execute: (action) => run({ github, core, context }, action) };
}
const mutations = (f) => f.calls.filter(([name]) => ['createLabel', 'addLabels', 'removeLabel', 'createComment', 'update'].includes(name));

test('dedicated references only, deduplicated, local, case insensitive', () => {
  assert.deepEqual(issueReferences('Related to #20\nRefs #31\n- Refs #20\n* related to #42\n'), [20, 31, 42]);
  for (const body of ['See #20', 'Refs owner/repo#20', 'Refs #20 and #21', 'Refs #20abc', 'Related to\n#20', 'Refs #0', 'Fixes #20']) assert.deepEqual(issueReferences(body), []);
});

test('all GitHub closing keyword forms and cross-repository references are rejected', async () => {
  for (const word of ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved']) {
    for (const ref of ['#20', 'UniClipboard/UniClip#20', 'https://github.com/UniClipboard/UniClip/issues/20']) assert.equal(closingReferences(`${word.toUpperCase()}: ${ref}`).length, 1);
  }
  assert.deepEqual(closingReferences('Fix rendering\nRelated to #20'), []);
  const f = fixture(); f.context.payload.pull_request.body = 'Closes #20'; await f.execute('validate');
  assert.equal(f.failures.length, 1); assert.deepEqual(mutations(f), []);
});

test('mobile version accepts stable, alpha and legacy beta; rejects desktop, malformed and unsafe input', () => {
  for (const version of [tag, 'v2.0.1.187', 'v2.0.1.187-beta1', 'v2.0.1.187-rc.2']) assert.equal(releasePattern.test(version), true);
  for (const version of ['v2.0.1', '2.0.1.187', 'v2.0.1.0', 'v2.0.1.187-', 'v2.0.1.187-alpha..1', 'v2.0.1.187\n/close', 'v2.0.1.187;echo']) assert.equal(releasePattern.test(version), false);
});

test('merge replaces only lifecycle labels, leaves open, creates missing labels and is idempotent', async () => {
  const f = fixture(); await f.execute('merge'); await f.execute('merge');
  assert.deepEqual(f.state.issue.labels, ['bug', 'status:ready-for-test']);
  assert.equal(f.state.issue.state, 'open'); assert.equal(f.state.comments.length, 1);
  assert.equal(f.calls.filter(([name]) => name === 'createLabel').length, 3);
  assert.equal(f.calls.some(([name]) => name === 'update'), false);
});

test('unmerged PR, linked PR and closed issue are not transitioned', async () => {
  for (const kind of ['unmerged', 'pr', 'closed']) {
    const f = fixture();
    if (kind === 'unmerged') f.context.payload.pull_request.merged = false;
    if (kind === 'pr') f.state.issue.pull_request = {};
    if (kind === 'closed') f.state.issue.state = 'closed';
    await f.execute('merge'); assert.equal(f.calls.some(([name]) => name === 'addLabels'), false);
  }
});

test('release and dispatch deduplicate per version, skip PRs, preserve status, use actual release URL', async () => {
  const f = fixture(); f.state.issue.labels = ['status:ready-for-test'];
  await f.execute('release'); f.context.eventName = 'release'; f.context.payload.release = { tag_name: tag }; await f.execute('release');
  assert.equal(f.state.comments.length, 1); assert.match(f.state.comments[0].body, /does not prove the fix is included/);
  assert.ok(!f.state.comments[0].body.includes('untrusted.invalid'));
  assert.deepEqual(f.state.issue.labels, ['status:ready-for-test']);
  f.context.payload.release.tag_name = 'v2.0.1.188'; await f.execute('release'); assert.equal(f.state.comments.length, 2);
  assert.ok(f.calls.some(([name, args]) => name === 'paginate' && args.labels === 'status:ready-for-test' && args.state === 'open' && args.per_page === 100));
});

test('invalid or unpublished release cannot send a notice', async () => {
  for (const kind of ['invalid', 'draft', 'unpublished']) {
    const f = fixture();
    if (kind === 'invalid') f.context.payload.client_payload.tag_name = 'v2.0.1';
    if (kind === 'draft') f.state.release.draft = true;
    if (kind === 'unpublished') f.state.release.published_at = null;
    await f.execute('release'); assert.equal(f.failures.length, 1); assert.deepEqual(mutations(f), []);
  }
});

test('forged human markers neither suppress release notices nor authorize verification', async () => {
  const f = fixture(); f.state.comments.push(notice(tag, { login: 'attacker', type: 'User' }));
  await f.execute('verify'); assert.equal(f.failures.length, 1); assert.deepEqual(mutations(f), []);
  await f.execute('release'); assert.equal(f.state.comments.length, 2);
});

test('only triage/write/maintain/admin can verify, including GitHub legacy role mapping', async () => {
  for (const permission of [{ permission: 'admin' }, { permission: 'maintain' }, { permission: 'write' }, { permission: 'triage' }, { permission: 'read', role_name: 'triage' }]) {
    const f = fixture(); f.state.permission = permission; f.state.comments.push(notice()); f.state.issue.labels = ['bug', 'status:ready-for-test'];
    await f.execute('verify'); assert.deepEqual(f.failures, []); assert.equal(f.state.issue.state, 'closed'); assert.deepEqual(f.state.issue.labels, ['bug', 'status:verified']);
  }
  for (const permission of ['read', 'none']) {
    const f = fixture(); f.state.permission = { permission }; f.state.comments.push(notice());
    await f.execute('verify'); assert.equal(f.failures.length, 1); assert.deepEqual(mutations(f), []);
  }
});

test('verification requires a matching notice, valid command and ready state', async () => {
  for (const kind of ['missing', 'mismatch', 'invalid', 'triage', 'closed']) {
    const f = fixture(); f.state.issue.labels = ['status:ready-for-test'];
    if (kind !== 'missing') f.state.comments.push(notice(kind === 'mismatch' ? 'v2.0.1.186' : tag));
    if (kind === 'invalid') f.context.payload.comment.body += '\nextra';
    if (kind === 'triage') f.state.issue.labels = ['status:triage'];
    if (kind === 'closed') f.state.issue.state = 'closed';
    await f.execute('verify'); assert.equal(f.failures.length, 1, kind); assert.deepEqual(mutations(f), []);
  }
});

test('verified closure is idempotent and retries a partial API failure without duplicate records', async () => {
  const f = fixture(); f.state.comments.push(notice()); f.state.issue.labels = ['status:ready-for-test'];
  const update = f.github.rest.issues.update;
  f.github.rest.issues.update = async () => { throw new Error('temporary API error'); };
  await assert.rejects(f.execute('verify'), /temporary API error/);
  f.github.rest.issues.update = update; await f.execute('verify'); await f.execute('verify');
  assert.equal(f.state.issue.state, 'closed'); assert.equal(f.state.comments.length, 2);
  assert.equal(f.calls.filter(([name]) => name === 'update').length, 1);
});

test('permission lookup failures propagate without API mutations', async () => {
  const f = fixture(); f.github.rest.repos.getCollaboratorPermissionLevel = async () => { throw new Error('forbidden'); };
  await assert.rejects(f.execute('verify'), /forbidden/); assert.deepEqual(mutations(f), []);
});

test('label race is tolerated only when the label actually exists; other errors fail', async () => {
  const f = fixture();
  f.github.rest.issues.createLabel = async ({ name }) => { f.state.labels.add(name); throw Object.assign(new Error('race'), { status: 422 }); };
  await f.execute('merge'); assert.deepEqual(f.failures, []);
  const bad = fixture(); bad.github.rest.issues.createLabel = async () => { throw Object.assign(new Error('denied'), { status: 403 }); };
  await assert.rejects(bad.execute('merge'), /denied/); assert.equal(bad.state.comments.length, 0);
});

test('privileged workflow handles forks from default-branch code with minimal permissions', () => {
  assert.deepEqual(workflow.on.pull_request_target.types, ['closed']);
  assert.ok(workflow.on.pull_request.types.includes('synchronize'));
  assert.deepEqual(workflow.permissions, {});
  const job = workflow.jobs.lifecycle;
  assert.equal(job.steps[0].with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(job.steps[0].with['persist-credentials'], false);
  assert.deepEqual(job.permissions, { contents: 'read', issues: 'write' });
  assert.ok(job.if.includes('merged == true')); assert.ok(job.if.includes('!github.event.issue.pull_request'));
  assert.deepEqual(workflow.on.repository_dispatch.types, ['issue-lifecycle-release']);
  assert.deepEqual(workflow.on.release.types, ['published']);
});

test('workflow entrypoints execute the tested module', async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const [jobName, eventName, expected] of [['validate-issue-references', 'pull_request', 'validate'], ['lifecycle', 'pull_request_target', 'merge'], ['lifecycle', 'issue_comment', 'verify'], ['lifecycle', 'release', 'release'], ['lifecycle', 'repository_dispatch', 'release']]) {
    let action;
    const script = workflow.jobs[jobName].steps.at(-1).with.script;
    await new AsyncFunction('require', 'github', 'context', 'core', script)((path) => {
      assert.equal(path, './.github/scripts/issue-lifecycle.cjs'); return { run: async (_, requested) => { action = requested; } };
    }, {}, { eventName }, {});
    assert.equal(action, expected);
  }
});

test('release wiring dispatches after GitHub publication for every platform and channel', () => {
  const release = parse(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const steps = release.jobs['github-release'].steps;
  const publish = steps.findIndex((step) => step.uses === 'ncipollo/release-action@v1');
  const dispatch = steps.findIndex((step) => step.name === 'Request issue release verification');
  assert.ok(dispatch > publish); assert.equal(steps[dispatch].if, undefined);
  assert.equal(steps[dispatch].env.RELEASE_TAG, '${{ inputs.tag_name }}');
  assert.equal(steps[dispatch].env.GH_TOKEN, '${{ secrets.GITHUB_TOKEN }}');
  assert.match(steps[dispatch].run, /event_type=issue-lifecycle-release/);
  assert.match(steps[dispatch].run, /client_payload\[tag_name\]=\$\{RELEASE_TAG\}/);
  assert.equal(release.permissions.contents, 'write');
  assert.ok(release.jobs.testflight); assert.ok(release.jobs['android-release']);
  const ci = parse(readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8'));
  assert.ok(ci.jobs['unit-tests'].steps.some((step) => step.run === 'node --test scripts/tests/issue-lifecycle.test.mjs'));
});
