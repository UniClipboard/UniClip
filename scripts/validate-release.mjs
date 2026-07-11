#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fail(message) {
  console.error(`Release validation failed: ${message}`);
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

const root = readRootArg();
const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
const changelog = readFileSync(resolve(root, 'CHANGES.md'), 'utf8').replace(/^\uFEFF/, '');
const expo = app.expo ?? {};
const version = String(expo.version ?? '');
const androidBuild = Number(expo.android?.versionCode);
const iosBuildText = String(expo.ios?.buildNumber ?? '');
const iosBuild = Number(iosBuildText);
const changelogTag = changelog.split(/\r?\n/, 1)[0].trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail('app.json expo.version must use MAJOR.MINOR.PATCH');
}
if (!Number.isSafeInteger(androidBuild) || androidBuild <= 0) {
  fail('app.json Android versionCode must be a positive integer');
}
if (!/^\d+$/.test(iosBuildText) || !Number.isSafeInteger(iosBuild) || iosBuild <= 0) {
  fail('app.json iOS buildNumber must be a positive integer string');
}
if (androidBuild !== iosBuild) {
  fail('Android versionCode and iOS buildNumber must match');
}

const escapedVersion = version.replaceAll('.', '\\.');
const tagPattern = new RegExp(`^v${escapedVersion}\\.${androidBuild}(?:-beta[1-9]\\d*)?$`);
if (!tagPattern.test(changelogTag)) {
  fail(
    `CHANGES.md must start with v${version}.${androidBuild} or v${version}.${androidBuild}-betaN`
  );
}

const prerelease = changelogTag.includes('-beta');
const output = `tag=${changelogTag}\nprerelease=${prerelease}\n`;
process.stdout.write(output);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, output);
}
