#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const moduleRoot = resolve(root, 'modules/uc-engine');
const pin = JSON.parse(readFileSync(resolve(moduleRoot, 'core-source.json'), 'utf8'));
const cacheRoot = resolve(moduleRoot, '.artifacts', pin.version);
const downloadsRoot = resolve(readArg('--downloads') ?? cacheRoot);
const markerPath = resolve(cacheRoot, 'prepared.json');
const moduleVersion = pin.version.replace(/^core-v/, '');

function fail(message) {
  console.error(`Unified engine release verification failed: ${message}`);
  process.exit(1);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) fail(`${name} requires a value`);
  return value;
}

async function sha256(filePath) {
  if (!existsSync(filePath)) fail(`missing ${filePath}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyHash(filePath, expected, label) {
  const actual = await sha256(filePath);
  if (actual !== expected) fail(`${label} checksum is ${actual}, expected ${expected}`);
}

function artifactMap(manifest) {
  return new Map(manifest.artifacts.map((artifact) => [artifact.name, artifact]));
}

async function verifyDownloads() {
  const manifestPath = resolve(downloadsRoot, 'release-manifest.json');
  await verifyHash(manifestPath, pin.releaseManifestSha256, 'release-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== pin.schemaVersion)
    fail('release manifest schema does not match pin');
  if (manifest.release?.version !== pin.version) fail('release version does not match pin');
  if (manifest.release?.commit !== pin.sourceCommit)
    fail('release source commit does not match pin');

  const manifestArtifacts = artifactMap(manifest);
  for (const [name, expected] of Object.entries(pin.artifacts)) {
    const declared = manifestArtifacts.get(name);
    if (!declared) fail(`release manifest does not declare ${name}`);
    if (declared.sha256 !== expected)
      fail(`release manifest checksum for ${name} does not match pin`);
    const filePath = resolve(downloadsRoot, name);
    if (!existsSync(filePath)) fail(`missing ${filePath}`);
    if (statSync(filePath).size !== declared.size)
      fail(`${name} size does not match release manifest`);
    await verifyHash(filePath, expected, name);
  }

  const archiveHash = pin.artifacts['UniClipboardEngine.xcframework.zip'];
  const swiftChecksum = readFileSync(
    resolve(downloadsRoot, 'UniClipboardEngine.xcframework.checksum.txt'),
    'utf8'
  ).trim();
  if (swiftChecksum !== archiveHash || pin.swiftPackageChecksum !== archiveHash) {
    fail('SwiftPM checksum does not match the pinned XCFramework archive');
  }
  const androidChecksum = readFileSync(
    resolve(downloadsRoot, 'UniClipboardEngine.aar.checksum.txt'),
    'utf8'
  ).trim();
  if (androidChecksum !== pin.artifacts['UniClipboardEngine.aar']) {
    fail('Android checksum file does not match the pinned AAR');
  }
  if (readFileSync(resolve(downloadsRoot, 'core-version.txt'), 'utf8').trim() !== pin.version) {
    fail('core-version.txt does not match pin');
  }
  if (
    readFileSync(resolve(downloadsRoot, 'source-commit.txt'), 'utf8').trim() !== pin.sourceCommit
  ) {
    fail('source-commit.txt does not match pin');
  }
}

const frameworkFiles = [
  'Info.plist',
  'ios-arm64/libuc_engine_uniffi.a',
  'ios-arm64_x86_64-simulator/libuc_engine_uniffi.a',
];

async function currentFrameworkHashes() {
  const frameworkRoot = resolve(moduleRoot, 'ios/UniClipboardEngine.xcframework');
  return Object.fromEntries(
    await Promise.all(
      frameworkFiles.map(async (file) => [file, await sha256(resolve(frameworkRoot, file))])
    )
  );
}

async function recordPrepared() {
  await verifyDownloads();
  const marker = {
    version: pin.version,
    sourceCommit: pin.sourceCommit,
    releaseManifestSha256: pin.releaseManifestSha256,
    frameworkFiles: await currentFrameworkHashes(),
  };
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
}

async function verifyPrepared() {
  await verifyDownloads();
  if (!existsSync(markerPath)) fail('prepared marker is missing; run npm run core:prepare');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (
    marker.version !== pin.version ||
    marker.sourceCommit !== pin.sourceCommit ||
    marker.releaseManifestSha256 !== pin.releaseManifestSha256
  ) {
    fail('prepared marker does not match core-source.json');
  }

  const preparedArtifacts = {
    'UniClipboardEngine.aar': resolve(
      moduleRoot,
      `android/release-maven/app/uniclipboard/uniclipboard-engine/${moduleVersion}/uniclipboard-engine-${moduleVersion}.aar`
    ),
    'UniClipboardEngine.pom': resolve(
      moduleRoot,
      `android/release-maven/app/uniclipboard/uniclipboard-engine/${moduleVersion}/uniclipboard-engine-${moduleVersion}.pom`
    ),
    'runtime-dependencies.txt': resolve(
      moduleRoot,
      'android/release-metadata/runtime-dependencies.txt'
    ),
    'uc_engine_uniffi.kt': resolve(moduleRoot, 'android/release-metadata/uc_engine_uniffi.kt'),
    'uc_engine_uniffi.swift': resolve(moduleRoot, 'ios/Bindings/uc_engine_uniffi.swift'),
  };
  for (const [name, filePath] of Object.entries(preparedArtifacts)) {
    await verifyHash(filePath, pin.artifacts[name], `prepared ${name}`);
  }

  const currentHashes = await currentFrameworkHashes();
  for (const [file, expected] of Object.entries(marker.frameworkFiles ?? {})) {
    if (currentHashes[file] !== expected) fail(`prepared XCFramework file ${file} was modified`);
  }
  if (Object.keys(marker.frameworkFiles ?? {}).length !== frameworkFiles.length) {
    fail('prepared marker does not cover every XCFramework input');
  }

  const packageJson = JSON.parse(readFileSync(resolve(moduleRoot, 'package.json'), 'utf8'));
  if (packageJson.version !== moduleVersion)
    fail('module package version does not match core release');
}

if (process.argv.includes('--record-prepared')) {
  await recordPrepared();
  console.log(`Recorded prepared ${pin.version} from ${pin.sourceCommit}`);
} else if (process.argv.includes('--prepared')) {
  await verifyPrepared();
  console.log(`Verified prepared ${pin.version} from ${pin.sourceCommit}`);
} else {
  await verifyDownloads();
  console.log(`Verified downloaded ${pin.version} from ${pin.sourceCommit}`);
}
