#!/usr/bin/env node
/**
 * bump-build — bump ONLY the build counter, keep the marketing version frozen.
 *
 * This is the everyday, high-frequency release path. It increments the single
 * monotonic build counter (`expo.android.versionCode`, mirrored into
 * `expo.ios.buildNumber`) and leaves `expo.version` untouched, so:
 *
 *   - iOS `CFBundleShortVersionString` (= expo.version) stays frozen → Apple
 *     does NOT re-trigger App Store / TestFlight review; only `CFBundleVersion`
 *     changes.
 *   - Android `versionName` becomes `${version}.${versionCode}` at prebuild
 *     (see plugins/withAndroidBuildVersionName.ts), so the in-app self-updater
 *     compares correctly against the release tag.
 *
 * The release MUST be tagged `v${version}.${versionCode}` (4 segments) — that
 * is the exact string the Android self-updater parses; `-b5` / `+5` style tags
 * do NOT parse and silently disable update detection.
 *
 * Usage:
 *   node scripts/bump-build.mjs [--dry-run]
 *   npm run release:build
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = join(root, 'app.json');
const dryRun = process.argv.includes('--dry-run');

const app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const expo = app.expo;
const version = String(expo.version); // 3-segment marketing version, stays frozen

const prevCode = Number(expo.android?.versionCode ?? 0);
const prevIosBuild = Number(expo.ios?.buildNumber ?? 0);
if (!Number.isFinite(prevCode) || !Number.isFinite(prevIosBuild)) {
  console.error('✗ could not read numeric versionCode / buildNumber from app.json');
  process.exit(1);
}

// One monotonic counter for both platforms; max() protects against any drift.
const next = Math.max(prevCode, prevIosBuild) + 1;
const tag = `v${version}.${next}`;

expo.android = expo.android ?? {};
expo.ios = expo.ios ?? {};
expo.android.versionCode = next;
expo.ios.buildNumber = String(next);

if (dryRun) {
  console.log(`[dry-run] marketing version (frozen): ${version}`);
  console.log(`[dry-run] build counter: ${prevCode}/${prevIosBuild} -> ${next}`);
  console.log(`[dry-run] android.versionCode -> ${next}, ios.buildNumber -> "${next}"`);
  console.log(`[dry-run] tag -> ${tag}`);
  process.exit(0);
}

writeFileSync(appJsonPath, JSON.stringify(app, null, 2) + '\n');

console.log(`✓ build ${next}  (marketing version ${version} frozen)`);
console.log(`  android.versionCode = ${next}, ios.buildNumber = "${next}"`);
console.log('');
console.log('Next steps:');
console.log(`  1. Add a "${tag}" section to the TOP of CHANGES.md (first line = the tag).`);
console.log('  2. Commit + tag + push:');
console.log(`       git add app.json CHANGES.md`);
console.log(`       git commit -m "chore(release): ${tag.slice(1)}"`);
console.log(`       git push`);
console.log(`       git tag ${tag} && git push origin ${tag}`);
