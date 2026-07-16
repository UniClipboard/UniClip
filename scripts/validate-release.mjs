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

function readAppConfig(root) {
  try {
    return JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`cannot read app.json: ${detail}`);
  }
}

function readChangelogTag(root, filename) {
  let changelog;
  try {
    changelog = readFileSync(resolve(root, filename), 'utf8').replace(/^\uFEFF/, '');
  } catch {
    fail(`${filename} is required`);
  }
  return changelog.split(/\r?\n/, 1)[0].trim();
}

const root = readRootArg();
const app = readAppConfig(root);
const expo = app.expo ?? {};
const version = String(expo.version ?? '');
const androidBuild = Number(expo.android?.versionCode);
const iosBuildText = String(expo.ios?.buildNumber ?? '');
const iosBuild = Number(iosBuildText);
const changelogTags = new Map([
  ['CHANGES.md', readChangelogTag(root, 'CHANGES.md')],
  ['CHANGES.en.md', readChangelogTag(root, 'CHANGES.en.md')],
]);

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
for (const [filename, tag] of changelogTags) {
  if (!tagPattern.test(tag)) {
    fail(
      `${filename} must start with v${version}.${androidBuild} or v${version}.${androidBuild}-betaN`
    );
  }
}

const changelogTag = changelogTags.get('CHANGES.md');
const englishChangelogTag = changelogTags.get('CHANGES.en.md');
if (changelogTag !== englishChangelogTag) {
  fail(`CHANGES.en.md must start with the same tag as CHANGES.md (${changelogTag})`);
}

const prerelease = changelogTag.includes('-beta');
const output = `tag=${changelogTag}\nprerelease=${prerelease}\n`;
process.stdout.write(output);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, output);
}
