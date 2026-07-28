#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import {
  analyzeKeyboardEvents,
  selectLatestKeyboardSession,
} from './keyboard-diagnostics-analysis.mjs';

const args = process.argv.slice(2);
const logPath = args.find((arg) => !arg.startsWith('--'));
const latestSessionOnly = args.includes('--latest-session');

if (!logPath) {
  console.error(
    'Usage: node scripts/check-keyboard-diagnostics.mjs <keyboard.jsonl> [--latest-session]'
  );
  process.exit(2);
}

const events = readFileSync(logPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line, index) => ({ ...JSON.parse(line), line: index + 1 }));

const analyzedEvents = latestSessionOnly ? selectLatestKeyboardSession(events) : events;
const failures = analyzeKeyboardEvents(analyzedEvents);
if (failures.length === 0) {
  console.log('PASS: no height jump or unrelated card update found');
  process.exit(0);
}

for (const failure of failures) console.error(`FAIL: ${failure.message}`);

process.exit(1);
