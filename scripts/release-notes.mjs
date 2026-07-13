#!/usr/bin/env node
/**
 * release-notes — split the TOP version block of CHANGES.md into per-platform
 * release notes.
 *
 * iOS and Android now ship one shared changelog but each channel shows its own
 * notes: the GitHub / Gitee Release body gets a two-section body (Android +
 * iOS), and TestFlight's "What to Test" gets the iOS-only notes.
 *
 * Source format (per version block, sub-headings optional):
 *
 *   v1.3.0.158
 *
 *   ### 通用
 *   - 修复：配对后未接入待处理的连接
 *
 *   ### iOS
 *   - 功能：保存文件时可自行选择保存位置
 *
 *   ### Android
 *   - 优化：后台设置简化为单个引导式开关
 *
 * Routing rules (backward compatible with the old flat single-block format):
 *   - A `### 通用 / Common` heading routes following bullets to BOTH platforms.
 *   - A `### iOS` heading routes following bullets to iOS only.
 *   - A `### Android / 安卓` heading routes following bullets to Android only.
 *   - Bullets before any heading default to "common". For those, a legacy
 *     inline tag — `（iOS）` / `(iOS)` or `（Android）` / `（安卓）` — still routes
 *     the single bullet to that platform, so old-style blocks keep working.
 *
 * Outputs (written into --out-dir, default cwd):
 *   - release-notes-github.md     two-section Markdown body (Android + iOS)
 *   - release-notes-android.txt   common + Android bullets
 *   - release-notes-ios.txt       common + iOS bullets
 *   - release-notes-testflight.txt  iOS notes as plain text (What to Test)
 *
 * Usage:
 *   node scripts/release-notes.mjs [--out-dir <dir>] [--root <repo>] [--print]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function fail(message) {
  console.error(`release-notes failed: ${message}`);
  process.exit(1);
}

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value) fail(`${name} requires a value`);
  return value;
}

const root = resolve(argValue('--root', import.meta.dirname + '/..'));
const outDir = resolve(argValue('--out-dir', process.cwd()));
const printOnly = process.argv.includes('--print');

const raw = readFileSync(resolve(root, 'CHANGES.md'), 'utf8').replace(/^﻿/, '');
const lines = raw.split(/\r?\n/);

const VERSION_LINE = /^v\d+\.\d+\.\d+/;
if (!lines[0] || !VERSION_LINE.test(lines[0].trim())) {
  fail('CHANGES.md must start with a version line, e.g. "v1.3.0.158"');
}
const tag = lines[0].trim();

// Collect the top block only: everything until the next version line.
const block = [];
for (let i = 1; i < lines.length; i++) {
  if (VERSION_LINE.test(lines[i].trim())) break;
  block.push(lines[i]);
}

const HEADING = /^#{1,6}\s*(.+?)\s*$/;
const IOS_INLINE = /（\s*iOS\s*）|\(\s*iOS\s*\)/i;
const ANDROID_INLINE = /（\s*(?:Android|安卓)\s*）|\(\s*(?:Android|安卓)\s*\)/i;

function classifyHeading(text) {
  const t = text.toLowerCase();
  if (t.includes('ios')) return 'ios';
  if (t.includes('android') || text.includes('安卓')) return 'android';
  return 'common'; // 通用 / common / anything else
}

const buckets = { common: [], ios: [], android: [] };
let current = 'common';
for (const line of block) {
  const heading = line.match(HEADING);
  if (heading) {
    current = classifyHeading(heading[1]);
    continue;
  }
  if (!line.trim().startsWith('-')) continue; // skip blanks / prose
  let bucket = current;
  // Legacy inline routing only applies to bullets left in the default bucket.
  if (current === 'common') {
    if (IOS_INLINE.test(line)) bucket = 'ios';
    else if (ANDROID_INLINE.test(line)) bucket = 'android';
  }
  buckets[bucket].push(line.trimEnd());
}

const androidNotes = [...buckets.common, ...buckets.android];
const iosNotes = [...buckets.common, ...buckets.ios];

if (androidNotes.length === 0 && iosNotes.length === 0) {
  fail(`no changelog bullets found under ${tag}`);
}

function section(title, notes) {
  const body = notes.length ? notes.join('\n') : '- （无更新）';
  return `## ${title}\n${body}`;
}

const githubBody = `${section('🤖 Android', androidNotes)}\n\n${section('🍎 iOS', iosNotes)}\n`;
const androidText = androidNotes.join('\n') + '\n';
const iosText = iosNotes.join('\n') + '\n';

if (printOnly) {
  process.stdout.write(`tag: ${tag}\n\n=== github.md ===\n${githubBody}\n=== testflight (iOS) ===\n${iosText}`);
  process.exit(0);
}

const files = {
  'release-notes-github.md': githubBody,
  'release-notes-android.txt': androidText,
  'release-notes-ios.txt': iosText,
  'release-notes-testflight.txt': iosText,
};
for (const [name, content] of Object.entries(files)) {
  writeFileSync(resolve(outDir, name), content);
}

console.log(`release-notes for ${tag}: ${androidNotes.length} Android bullet(s), ${iosNotes.length} iOS bullet(s)`);
console.log(`wrote ${Object.keys(files).join(', ')} to ${outDir}`);
