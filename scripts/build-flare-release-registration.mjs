#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function fail(message) {
  console.error(`build-flare-release-registration failed: ${message}`);
  process.exit(1);
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value) fail(`${name} requires a value`);
  return value;
}

export function buildRegistration({ manifest, apkDir, publicBaseUrl, source }) {
  const artifacts = manifest.assets.map((asset) => {
    const filePath = resolve(apkDir, asset.name);
    if (!existsSync(filePath)) throw new Error(`APK does not exist: ${filePath}`);
    return {
      platform: 'android',
      architecture: asset.name.includes('arm64-v8a') ? 'arm64-v8a' : undefined,
      format: 'apk',
      filename: asset.name,
      r2Key: `android/artifacts/${manifest.tagName}/${asset.name}`,
      downloadUrl: `${publicBaseUrl}/android/artifacts/${manifest.tagName}/${asset.name}`,
      size: statSync(filePath).size,
      sha256: asset.sha256,
    };
  });

  if (artifacts.length === 0) throw new Error('Registration requires at least one APK');

  return {
    product: 'android',
    version: manifest.version,
    tagName: manifest.tagName,
    prerelease: manifest.prerelease,
    publishedAt: manifest.pub_date,
    source,
    notes: manifest.notes,
    artifacts,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestPath = argValue('--manifest');
  const apkDir = resolve(argValue('--apk-dir', 'apk'));
  const publicBaseUrl = argValue('--public-base-url', 'https://release.uniclipboard.app');
  const source = argValue('--source', 'github-actions');
  const output = argValue('--output');

  if (!manifestPath) fail('--manifest is required');
  if (!output) fail('--output is required');

  try {
    const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
    const registration = buildRegistration({ manifest, apkDir, publicBaseUrl, source });
    const outputPath = resolve(output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(registration, null, 2)}\n`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
