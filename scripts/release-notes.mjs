#!/usr/bin/env node
/**
 * release-notes — split the top version blocks of CHANGES.md and
 * CHANGES.en.md into localized, per-platform release notes.
 *
 * The GitHub / Gitee body contains visible Simplified Chinese and English
 * sections, each split into Android and iOS. TestFlight gets localized iOS-only
 * notes.
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
 *   - release-notes-github.md       bilingual Markdown body
 *   - release-notes-{android,ios}.txt          Chinese platform notes
 *   - release-notes-{android,ios}.en.txt       English platform notes
 *   - release-notes-testflight{,.en}.txt       localized iOS plain text
 *   - changelogs/<tag>.{android,ios}.{zh,en}.md versioned client changelogs
 *
 * Usage:
 *   node scripts/release-notes.mjs [--out-dir <dir>] [--root <repo>] [--print | --check]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const checkOnly = process.argv.includes('--check');

const VERSION_LINE = /^v\d+\.\d+\.\d+/;
const HEADING = /^#{1,6}\s*(.+?)\s*$/;
const IOS_INLINE = /（\s*iOS\s*）|\(\s*iOS\s*\)/i;
const ANDROID_INLINE = /（\s*(?:Android|安卓)\s*）|\(\s*(?:Android|安卓)\s*\)/i;

function classifyHeading(text) {
  const lower = text.toLowerCase();
  if (lower.includes('ios')) return 'ios';
  if (lower.includes('android') || text.includes('安卓')) return 'android';
  return 'common';
}

function parseChangelog(filename) {
  let raw;
  try {
    raw = readFileSync(resolve(root, filename), 'utf8').replace(/^﻿/, '');
  } catch {
    fail(`${filename} is required`);
  }

  const lines = raw.split(/\r?\n/);
  if (!lines[0] || !VERSION_LINE.test(lines[0].trim())) {
    fail(`${filename} must start with a version line, e.g. "v1.3.0.158"`);
  }

  const tag = lines[0].trim();
  const block = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (VERSION_LINE.test(lines[index].trim())) break;
    block.push(lines[index]);
  }

  const buckets = { common: [], ios: [], android: [] };
  let current = 'common';
  for (const line of block) {
    const heading = line.match(HEADING);
    if (heading) {
      current = classifyHeading(heading[1]);
      continue;
    }
    if (!line.trim().startsWith('-')) continue;

    let bucket = current;
    if (current === 'common') {
      if (IOS_INLINE.test(line)) bucket = 'ios';
      else if (ANDROID_INLINE.test(line)) bucket = 'android';
    }
    buckets[bucket].push(line.trimEnd());
  }

  const androidNotes = [...buckets.common, ...buckets.android];
  const iosNotes = [...buckets.common, ...buckets.ios];
  if (androidNotes.length === 0 && iosNotes.length === 0) {
    fail(`no changelog bullets found in ${filename} under ${tag}`);
  }

  return { tag, androidNotes, iosNotes };
}

function platformSection(title, notes, emptyLabel) {
  const body = notes.length ? notes.join('\n') : `- ${emptyLabel}`;
  return `### ${title}\n${body}`;
}

function languageSection(title, locale, changelog, emptyLabel) {
  return `## [${locale}] ${title}\n\n${platformSection(
    'Android',
    changelog.androidNotes,
    emptyLabel
  )}\n\n${platformSection('iOS', changelog.iosNotes, emptyLabel)}`;
}

const chinese = parseChangelog('CHANGES.md');
const english = parseChangelog('CHANGES.en.md');
if (chinese.tag !== english.tag) {
  fail(
    `CHANGES.md and CHANGES.en.md must start with the same version (${chinese.tag} != ${english.tag})`
  );
}
const tag = chinese.tag;

const githubBody = `${languageSection(
  '简体中文',
  'zh-CN',
  chinese,
  '（无更新）'
)}\n\n${languageSection('English', 'en', english, 'No updates.')}\n`;
const chineseAndroidText = chinese.androidNotes.join('\n') + '\n';
const chineseIosText = chinese.iosNotes.join('\n') + '\n';
const englishAndroidText = english.androidNotes.join('\n') + '\n';
const englishIosText = english.iosNotes.join('\n') + '\n';
const changelogFiles = {
  [`${tag}.android.zh.md`]: chineseAndroidText,
  [`${tag}.ios.zh.md`]: chineseIosText,
  [`${tag}.android.en.md`]: englishAndroidText,
  [`${tag}.ios.en.md`]: englishIosText,
};

if (checkOnly) {
  for (const [name, expected] of Object.entries(changelogFiles)) {
    const relativePath = `changelogs/${name}`;
    let actual;
    try {
      actual = readFileSync(resolve(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
    } catch {
      fail(`missing ${relativePath}; run node scripts/release-notes.mjs --out-dir .`);
    }
    if (actual !== expected) {
      fail(`${relativePath} is out of date; run node scripts/release-notes.mjs --out-dir .`);
    }
  }

  console.log(`validated release-notes and changelog files for ${tag}`);
  process.exit(0);
}

if (printOnly) {
  process.stdout.write(
    `tag: ${tag}\n\n=== github.md ===\n${githubBody}\n=== testflight (zh-CN) ===\n${chineseIosText}\n=== testflight (en) ===\n${englishIosText}`
  );
  process.exit(0);
}

const files = {
  'release-notes-github.md': githubBody,
  'release-notes-android.txt': chineseAndroidText,
  'release-notes-android.en.txt': englishAndroidText,
  'release-notes-ios.txt': chineseIosText,
  'release-notes-ios.en.txt': englishIosText,
  'release-notes-testflight.txt': chineseIosText,
  'release-notes-testflight.en.txt': englishIosText,
};
for (const [name, content] of Object.entries(files)) {
  writeFileSync(resolve(outDir, name), content);
}

const changelogDir = resolve(outDir, 'changelogs');
mkdirSync(changelogDir, { recursive: true });
for (const [name, content] of Object.entries(changelogFiles)) {
  writeFileSync(resolve(changelogDir, name), content);
}

console.log(
  `release-notes for ${tag}: zh-CN ${chinese.androidNotes.length} Android / ${chinese.iosNotes.length} iOS, en ${english.androidNotes.length} Android / ${english.iosNotes.length} iOS bullet(s)`
);
console.log(
  `wrote ${Object.keys(files).join(', ')} and ${
    Object.keys(changelogFiles).length
  } changelog file(s) to ${outDir}`
);
