#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repository = 'https://github.com/UniClipboard/UniClipboard.git';

function fail(message) {
  console.error(`uc-mobile source validation failed: ${message}`);
  process.exit(1);
}

function readRootArg() {
  const rootIndex = process.argv.indexOf('--root');
  if (rootIndex === -1) {
    return resolve(import.meta.dirname, '..');
  }

  const root = process.argv[rootIndex + 1];
  if (!root) {
    fail('--root requires a directory');
  }
  return resolve(root);
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) {
    fail(`could not run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.status}`;
    fail(detail);
  }
}

const root = readRootArg();
let commit;
try {
  commit = readFileSync(resolve(root, 'rust-core/source-ref'), 'utf8').trim();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`cannot read rust-core/source-ref: ${detail}`);
}

if (!/^[0-9a-f]{40}$/.test(commit)) {
  fail('rust-core/source-ref must contain exactly one full lowercase commit SHA');
}

const checkout = mkdtempSync(join(tmpdir(), 'uniclip-uc-core-ref-'));
try {
  runGit(['init', '--quiet'], checkout);
  runGit(['remote', 'add', 'origin', repository], checkout);
  runGit(['fetch', '--quiet', '--depth', '1', 'origin', commit], checkout);
} finally {
  rmSync(checkout, { recursive: true, force: true });
}

console.log(`uc-mobile source commit is available: ${commit}`);
