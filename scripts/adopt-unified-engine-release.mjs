#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const ENGINE_REPOSITORY = 'UniClipboard/Engine';
const REQUIRED_ARTIFACTS = [
  'UniClipboardEngine.aar',
  'UniClipboardEngine.aar.checksum.txt',
  'UniClipboardEngine.pom',
  'UniClipboardEngine.xcframework.checksum.txt',
  'UniClipboardEngine.xcframework.zip',
  'runtime-dependencies.txt',
  'source-commit.txt',
  'uc_engine_uniffi.kt',
  'uc_engine_uniffi.swift',
  'version.txt',
];

function fail(message) {
  process.stderr.write(`Unified Engine adoption failed: ${message}\n`);
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) fail(`${name} requires a value`);
  return value;
}

async function manifestBytes(version) {
  const path = readArg('--manifest');
  if (path) return readFileSync(resolve(path));
  const url = `https://github.com/${ENGINE_REPOSITORY}/releases/download/${version}/release-manifest.json`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail(`cannot download release manifest: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const root = resolve(readArg('--root') ?? resolve(import.meta.dirname, '..'));
const version = readArg('--version');
const sourceCommit = readArg('--source-commit');
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  fail('version must be a v-prefixed semantic version');
}
if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? '')) {
  fail('source commit must be a full lowercase Git commit');
}

const bytes = await manifestBytes(version);
let manifest;
try {
  manifest = JSON.parse(bytes.toString('utf8'));
} catch (error) {
  fail(`release manifest is invalid JSON: ${String(error)}`);
}
if (manifest.schemaVersion !== 1) fail('unsupported release manifest schema');
if (manifest.release?.version !== version) fail('release version does not match the notification');
if (manifest.release?.commit !== sourceCommit) {
  fail('release source commit does not match the notification');
}

const artifacts = new Map(
  (Array.isArray(manifest.artifacts) ? manifest.artifacts : []).map((artifact) => [
    artifact.name,
    artifact,
  ])
);
for (const name of REQUIRED_ARTIFACTS) {
  if (!/^[0-9a-f]{64}$/.test(artifacts.get(name)?.sha256 ?? '')) {
    fail(`release manifest does not declare a valid ${name}`);
  }
}

const artifactHashes = Object.fromEntries(
  REQUIRED_ARTIFACTS.map((name) => [name, artifacts.get(name).sha256])
);
const pin = {
  schemaVersion: 1,
  repository: ENGINE_REPOSITORY,
  version,
  sourceCommit,
  releaseManifestSha256: createHash('sha256').update(bytes).digest('hex'),
  swiftPackageChecksum: artifactHashes['UniClipboardEngine.xcframework.zip'],
  artifacts: artifactHashes,
};
writeFileSync(
  resolve(root, 'modules/uc-engine/core-source.json'),
  `${JSON.stringify(pin, null, 2)}\n`
);

const modulePath = resolve(root, 'modules/uc-engine/package.json');
const modulePackage = JSON.parse(readFileSync(modulePath, 'utf8'));
const moduleVersion = version.replace(/^v/, '');
modulePackage.version = moduleVersion;
writeFileSync(modulePath, `${JSON.stringify(modulePackage, null, 2)}\n`);

const lockPath = resolve(root, 'package-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
if (!lock.packages?.['modules/uc-engine'])
  fail('package-lock.json is missing the uc-engine workspace');
lock.packages['modules/uc-engine'].version = moduleVersion;
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

process.stdout.write(`Adopted Engine ${version} at ${sourceCommit}\n`);
