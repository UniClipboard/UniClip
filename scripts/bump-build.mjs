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
import { format, resolveConfig } from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = join(root, 'app.json');
const dryRun = process.argv.includes('--dry-run');

let app;
try {
  app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`✗ could not read app.json: ${detail}`);
  process.exit(1);
}
const expo = app.expo;
if (!expo) {
  console.error('✗ app.json must contain an expo object');
  process.exit(1);
}
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

const prettierConfig = await resolveConfig(appJsonPath);
writeFileSync(
  appJsonPath,
  await format(JSON.stringify(app), { ...prettierConfig, filepath: appJsonPath })
);

console.log(`✓ build ${next}  (marketing version ${version} frozen)`);
console.log(`  android.versionCode = ${next}, ios.buildNumber = "${next}"`);
console.log('');
console.log('Next steps:');
console.log(`  1. Add matching "${tag}" sections to CHANGES.md and CHANGES.en.md.`);
console.log('     Group notes under Common / iOS / Android sub-headings;');
console.log('     preview both languages with: node scripts/release-notes.mjs --print');
console.log('     generate client files with: npm run changelog:generate');
console.log('  2. Commit and push the release metadata:');
console.log(`       git add app.json CHANGES.md CHANGES.en.md changelogs`);
console.log(`       git commit -m "chore(release): ${tag.slice(1)}"`);
console.log(`       git push origin main`);
console.log('  3. In GitHub Actions, run "build" on main with publish_release enabled.');
console.log(`     CI will create ${tag} only after every check and both platform builds pass.`);
