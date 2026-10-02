#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { classifierWorkflowOnly, recipeWorkflows, sameNativeRecipe } from './ci-native-recipes.mjs';

// Only paths known not to feed an app build may avoid native compilation.
// Build workflows require content comparison; policy code is validation-only.
const validationOnlyFiles = new Set([
  'AGENTS.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt',
  'scripts/ci-changes.mjs', 'scripts/ci-native-recipes.mjs',
  'scripts/tests/ci-changes.test.mjs', 'scripts/tests/ci-workflows.test.mjs',
  'scripts/tests/ci-native-recipes.test.mjs', 'src/__tests__/releaseWorkflow.test.ts',
  '.github/workflows/issue-lifecycle.yml',
  '.github/scripts/issue-lifecycle.cjs',
  'scripts/tests/issue-lifecycle.test.mjs',
  '.github/workflows/test.yml',
  '.github/workflows/code-style.yml',
  '.github/workflows/react-doctor.yml',
]);

export function isValidationOnly(path) {
  return typeof path === 'string' && !path.includes('..') && (
    path.startsWith('docs/') ||
    /^(?:README|CHANGES)(?:\.[\w-]+)?\.md$/.test(path) ||
    validationOnlyFiles.has(path)
  );
}

export function classifyPaths(paths, snapshots = {}) {
  if (!Array.isArray(paths)) return { nativeRequired: true, reason: 'Unrecognized change list.' };
  for (const path of paths) {
    if (isValidationOnly(path)) continue;
    try {
      if (path === '.github/workflows/ci-changes.yml' && classifierWorkflowOnly(snapshots.after(path))) continue;
      if (recipeWorkflows.has(path) && sameNativeRecipe(path, snapshots.before(path), snapshots.after(path))) continue;
    } catch { /* Unavailable snapshots must require native builds. */ }
    return { nativeRequired: true, reason: 'Native-affecting or unrecognized changes require compilation.' };
  }
  return { nativeRequired: false, reason: paths.length ? 'Only documentation, validation or scheduling changed; native build recipes are unchanged.' : 'The compared commits have no file changes.' };
}

const validSha = (sha) => typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) && !/^0+$/.test(sha);

export function diffRange(eventName, event) {
  if (eventName === 'pull_request') {
    const base = event.pull_request?.base?.sha;
    const head = event.pull_request?.head?.sha;
    if (!validSha(base) || !validSha(head)) throw new Error('Missing or invalid PR base/head SHA.');
    return `${base}...${head}`;
  }
  if (eventName === 'push' && event.ref === 'refs/heads/main') {
    if (!validSha(event.before) || !validSha(event.after)) throw new Error('Missing or invalid push before/after SHA.');
    return `${event.before}..${event.after}`;
  }
  throw new Error('No safe automatic diff is available for this event.');
}

export function detectChanges({ eventName, event, cwd = process.cwd(), git = execFileSync }) {
  // A manually requested build must never depend on the changed-path policy.
  if (eventName === 'workflow_dispatch') return { nativeRequired: true, reason: 'Manual builds always build the selected platforms.' };
  try {
    const range = diffRange(eventName, event);
    // Disable rename detection so BOTH old and new paths are classified. -z
    // preserves spaces/newlines; no shell ever evaluates event data or paths.
    const output = git('git', ['diff', '--name-only', '--no-renames', '-z', range, '--'], {
      cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const paths = output.split('\0').filter(Boolean);
    let base;
    const head = eventName === 'pull_request' ? event.pull_request.head.sha : event.after;
    const snapshot = (sha, path) => git('git', ['show', `${sha}:${path}`], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return classifyPaths(paths, {
      before(path) {
        base ??= eventName === 'pull_request'
          ? git('git', ['merge-base', event.pull_request.base.sha, head], { cwd, encoding: 'utf8' }).trim()
          : event.before;
        if (!validSha(base)) throw new Error('Invalid comparison base');
        return snapshot(base, path);
      },
      after: (path) => snapshot(head, path),
    });
  } catch {
    // Shallow/missing history, force-push boundaries, API/event problems, and
    // oversized diffs must not turn a native change into a successful no-op.
    return { nativeRequired: true, reason: 'Change detection was unavailable; conservatively building both platforms.' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let decision;
  try {
    decision = detectChanges({ eventName: process.env.GITHUB_EVENT_NAME, event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) });
  } catch {
    decision = { nativeRequired: true, reason: 'Event data was unavailable; conservatively building both platforms.' };
  }
  // Failure to write outputs is a failed job, never an empty successful decision.
  appendFileSync(process.env.GITHUB_OUTPUT, `native_required=${decision.nativeRequired}\nreason=${decision.reason}\n`);
  console.log(decision.reason);
}
