#!/usr/bin/env node
/**
 * bump-version — bump the marketing version. RARE, and the one thing that
 * re-triggers iOS App Store / TestFlight review, so do it deliberately.
 *
 * Sets `expo.version` to a new 3-segment marketing version (iOS
 * `CFBundleShortVersionString` must be exactly MAJOR.MINOR.PATCH — Apple
 * rejects 4-segment marketing versions) AND still bumps the build counter
 * (never reset), so the release stays tagged `v${newVersion}.${versionCode}`
 * and the Android self-updater's comparison remains monotonic across the
 * version change.
 *
 * Usage:
 *   node scripts/bump-version.mjs <major.minor.patch> [--dry-run]
 *   npm run release:version -- 1.4.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { format, resolveConfig } from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = join(root, 'app.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const newVersion = args.find((a) => !a.startsWith('--'));

if (!newVersion) {
  console.error('Usage: node scripts/bump-version.mjs <major.minor.patch> [--dry-run]');
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(
    `✗ "${newVersion}" is not a 3-segment version. iOS CFBundleShortVersionString must be MAJOR.MINOR.PATCH (the build counter lives in the tag/versionName, not here).`
  );
  process.exit(1);
}

const app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
const expo = app.expo;
const prevVersion = String(expo.version);

const prevCode = Number(expo.android?.versionCode ?? 0);
const prevIosBuild = Number(expo.ios?.buildNumber ?? 0);
if (!Number.isFinite(prevCode) || !Number.isFinite(prevIosBuild)) {
  console.error('✗ could not read numeric versionCode / buildNumber from app.json');
  process.exit(1);
}

// Build counter keeps climbing across the marketing-version change (never reset).
const next = Math.max(prevCode, prevIosBuild) + 1;
const tag = `v${newVersion}.${next}`;

expo.version = newVersion;
expo.android = expo.android ?? {};
expo.ios = expo.ios ?? {};
expo.android.versionCode = next;
expo.ios.buildNumber = String(next);

if (dryRun) {
  console.log(
    `[dry-run] marketing version: ${prevVersion} -> ${newVersion} (⚠ re-triggers iOS review)`
  );
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

console.log(`✓ marketing version ${prevVersion} -> ${newVersion}  (build ${next})`);
console.log('  ⚠ This is a NEW iOS marketing version — expect one App Store / TestFlight review.');
console.log(`  android.versionCode = ${next}, ios.buildNumber = "${next}"`);
console.log('');
console.log('Next steps:');
console.log(`  1. Add a "${tag}" section to the TOP of CHANGES.md (first line = the tag).`);
console.log('  2. Commit and push the release metadata:');
console.log(`       git add app.json CHANGES.md`);
console.log(`       git commit -m "chore(release): ${tag.slice(1)}"`);
console.log(`       git push origin main`);
console.log('  3. In GitHub Actions, run "build" on main with publish_release enabled.');
console.log(`     CI will create ${tag} only after every check and both platform builds pass.`);
