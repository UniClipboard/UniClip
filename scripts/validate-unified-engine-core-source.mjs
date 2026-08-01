#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredArtifacts = [
  'UniClipboardEngine.aar',
  'UniClipboardEngine.aar.checksum.txt',
  'UniClipboardEngine.pom',
  'UniClipboardEngine.xcframework.checksum.txt',
  'UniClipboardEngine.xcframework.zip',
  'runtime-dependencies.txt',
  'source-commit.txt',
  'uc_engine_uniffi.kt',
  'uc_engine_uniffi.swift',
];
const versionArtifacts = ['version.txt', 'core-version.txt'];

function fail(message) {
  console.error(`Unified engine source validation failed: ${message}`);
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) fail(`${name} requires a value`);
  return value;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`cannot read ${label}: ${detail}`);
  }
}

function requireHash(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value ?? '')) fail(`${label} must be a SHA-256 checksum`);
}

const root = resolve(readArg('--root') ?? resolve(import.meta.dirname, '..'));
const pin = readJson(resolve(root, 'modules/uc-engine/core-source.json'), 'core-source.json');

if (pin.schemaVersion !== 1) fail('unsupported core-source.json schema version');
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin.repository ?? '')) {
  fail('repository must be an owner/name pair');
}
if (!/^(?:core-)?v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pin.version ?? '')) {
  fail('version must be a v or core-v semantic version');
}
if (!/^[0-9a-f]{40}$/.test(pin.sourceCommit ?? '')) {
  fail('sourceCommit must be a full lowercase commit SHA');
}
if (pin.artifactSource === 'local-build') {
  requireHash(pin.sourceStateSha256, 'sourceStateSha256');
  fail('local engine builds cannot validate a release');
}
requireHash(pin.releaseManifestSha256, 'releaseManifestSha256');
requireHash(pin.swiftPackageChecksum, 'swiftPackageChecksum');
for (const name of requiredArtifacts) requireHash(pin.artifacts?.[name], `artifacts.${name}`);
const presentVersionArtifacts = versionArtifacts.filter((name) => pin.artifacts?.[name]);
if (presentVersionArtifacts.length !== 1) {
  fail('artifacts must contain exactly one supported version file');
}
requireHash(pin.artifacts[presentVersionArtifacts[0]], `artifacts.${presentVersionArtifacts[0]}`);
if (pin.swiftPackageChecksum !== pin.artifacts['UniClipboardEngine.xcframework.zip']) {
  fail('swiftPackageChecksum does not match the XCFramework archive');
}

const manifestPath = readArg('--manifest');
let manifestBytes;
if (manifestPath) {
  manifestBytes = readFileSync(resolve(manifestPath));
} else {
  const url = `https://github.com/${pin.repository}/releases/download/${pin.version}/release-manifest.json`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) fail(`cannot download release manifest: HTTP ${response.status}`);
  manifestBytes = Buffer.from(await response.arrayBuffer());
}

const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
if (manifestHash !== pin.releaseManifestSha256) {
  fail(`release-manifest.json checksum is ${manifestHash}, expected ${pin.releaseManifestSha256}`);
}

let manifest;
try {
  manifest = JSON.parse(manifestBytes.toString('utf8'));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  fail(`release-manifest.json is invalid JSON: ${detail}`);
}
if (manifest.schemaVersion !== pin.schemaVersion)
  fail('release manifest schema does not match pin');
if (manifest.release?.version !== pin.version) fail('release version does not match pin');
if (manifest.release?.commit !== pin.sourceCommit) fail('release source commit does not match pin');

const manifestArtifacts = new Map(
  (Array.isArray(manifest.artifacts) ? manifest.artifacts : []).map((artifact) => [
    artifact.name,
    artifact,
  ])
);
for (const name of [...requiredArtifacts, presentVersionArtifacts[0]]) {
  const declared = manifestArtifacts.get(name);
  if (!declared) fail(`release manifest does not declare ${name}`);
  if (declared.sha256 !== pin.artifacts[name]) {
    fail(`release manifest checksum for ${name} does not match pin`);
  }
}

console.log(`Unified engine source is available: ${pin.version} (${pin.sourceCommit})`);
