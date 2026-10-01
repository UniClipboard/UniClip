#!/usr/bin/env node
// Pin the Engine to any commit; artifacts are built from that source instead of a release tag.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { inspectCommit } from './lib/engine-commit.mjs';

function fail(message) {
  process.stderr.write(`Engine commit pin failed: ${message}\n`);
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) fail(`${name} requires a value`);
  return value;
}

const root = resolve(readArg('--root') ?? resolve(import.meta.dirname, '..'));
const engineDirectory = resolve(
  readArg('--engine-dir') ?? process.env.UC_ENGINE_REPOSITORY ?? resolve(root, '../Engine')
);
const VALUE_FLAGS = new Set(['--root', '--engine-dir']);
const ref = process.argv.slice(2).find((arg, i, all) => !arg.startsWith('--') && !VALUE_FLAGS.has(all[i - 1]));
if (!ref) fail('usage: npm run core:pin -- <commit-or-ref> [--engine-dir <path>] [--allow-unmerged]');
if (!existsSync(resolve(engineDirectory, 'Cargo.toml'))) fail(`Engine clone not found: ${engineDirectory}`);

if (!process.argv.includes('--no-fetch')) {
  execFileSync('git', ['-C', engineDirectory, 'fetch', '--quiet', 'origin'], { stdio: 'inherit' });
}
let inspected;
try {
  inspected = inspectCommit(engineDirectory, ref);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
if (!inspected.onMain && !process.argv.includes('--allow-unmerged')) {
  fail(`${inspected.sourceCommit} is not on Engine main; release validation would reject it`);
}

const pin = {
  schemaVersion: 1,
  repository: 'UniClipboard/Engine',
  version: inspected.version,
  sourceCommit: inspected.sourceCommit,
  artifactSource: 'commit',
};
writeFileSync(resolve(root, 'modules/uc-engine/core-source.json'), `${JSON.stringify(pin, null, 2)}\n`);

const moduleVersion = inspected.version.replace(/^v/, '');
const modulePath = resolve(root, 'modules/uc-engine/package.json');
const modulePackage = JSON.parse(readFileSync(modulePath, 'utf8'));
modulePackage.version = moduleVersion;
writeFileSync(modulePath, `${JSON.stringify(modulePackage, null, 2)}\n`);

const lockPath = resolve(root, 'package-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
if (!lock.packages?.['modules/uc-engine']) fail('package-lock.json is missing the uc-engine workspace');
lock.packages['modules/uc-engine'].version = moduleVersion;
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

process.stdout.write(`Pinned Engine ${inspected.sourceCommit} (${inspected.version}). Run npm run core:prepare next.\n`);
