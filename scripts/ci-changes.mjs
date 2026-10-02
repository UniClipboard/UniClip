#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Only paths known not to feed an app build may avoid native compilation.
// Build workflows and this policy itself deliberately remain outside this list.
const validationOnlyFiles = new Set([
  'AGENTS.md', 'LICENSE', 'LICENSE.md', 'LICENSE.txt',
  '.github/workflows/issue-lifecycle.yml',
  '.github/scripts/issue-lifecycle.cjs',
  'scripts/tests/issue-lifecycle.test.mjs',
  '.github/workflows/release.yml',
  '.github/workflows/test.yml',
  '.github/workflows/code-style.yml',
  '.github/workflows/react-doctor.yml',
  '.github/workflows/testflight-notes.yml',
]);

export function isValidationOnly(path) {
  return typeof path === 'string' && !path.includes('..') && (
    path.startsWith('docs/') ||
    /^(?:README|CHANGES)(?:\.[\w-]+)?\.md$/.test(path) ||
    validationOnlyFiles.has(path)
  );
}

export function classifyPaths(paths) {
  if (!Array.isArray(paths) || paths.some((path) => !isValidationOnly(path))) {
    return { nativeRequired: true, reason: 'Native-affecting or unrecognized paths changed.' };
  }
  return {
    nativeRequired: false,
    reason: paths.length ? 'Only documentation or known validation/publishing paths changed.' : 'The compared commits have no file changes.',
  };
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
    return classifyPaths(output.split('\0').filter(Boolean));
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
