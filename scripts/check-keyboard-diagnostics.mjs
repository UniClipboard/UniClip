#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const [logPath] = process.argv.slice(2);

if (!logPath) {
  console.error('Usage: node scripts/check-keyboard-diagnostics.mjs <keyboard.jsonl>');
  process.exit(2);
}

const events = readFileSync(logPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line, index) => ({ ...JSON.parse(line), line: index + 1 }));

const staleCardRenders = [];
let expectedCardCount;

for (const event of events) {
  if (
    event.event === 'presentation.publish' &&
    event.fields?.surface === 'cardList' &&
    event.fields?.field === 'cards'
  ) {
    expectedCardCount = {
      count: Number(event.fields.value),
      line: event.line,
    };
    continue;
  }

  if (expectedCardCount && event.event === 'view.render' && event.fields?.surface === 'cards') {
    const renderedCount = Number(event.fields.count);
    if (renderedCount !== expectedCardCount.count) {
      staleCardRenders.push({
        publishedLine: expectedCardCount.line,
        publishedCount: expectedCardCount.count,
        renderedLine: event.line,
        renderedCount,
      });
    }
    expectedCardCount = undefined;
  }
}

const layoutsByController = new Map();
for (const event of events) {
  if (event.event !== 'controller.layout' || !event.fields?.controllerID) {
    continue;
  }

  const heights = layoutsByController.get(event.fields.controllerID) ?? [];
  heights.push({
    height: Number(event.fields.height),
    surfaceHeight: Number(event.fields.surfaceHeight),
    line: event.line,
  });
  layoutsByController.set(event.fields.controllerID, heights);
}

const heightJumps = [];
for (const [controllerID, layouts] of layoutsByController) {
  const oversized = layouts.find(
    ({ height, surfaceHeight }) => height > 500 && (!surfaceHeight || surfaceHeight > 500)
  );
  const keyboardSized = layouts.find(({ height }) => height > 0 && height <= 400);
  if (oversized && keyboardSized && oversized.line < keyboardSized.line) {
    heightJumps.push({ controllerID, oversized, keyboardSized });
  }
}

if (staleCardRenders.length === 0 && heightJumps.length === 0) {
  console.log('PASS: no stale card render or full-height keyboard jump found');
  process.exit(0);
}

for (const failure of staleCardRenders) {
  console.error(
    `FAIL: cards published as ${failure.publishedCount} at line ${failure.publishedLine}, ` +
      `then rendered as ${failure.renderedCount} at line ${failure.renderedLine}`
  );
}

for (const failure of heightJumps) {
  console.error(
    `FAIL: controller ${failure.controllerID} laid out at ${failure.oversized.height} ` +
      `(line ${failure.oversized.line}) before ${failure.keyboardSized.height} ` +
      `(line ${failure.keyboardSized.line})`
  );
}

process.exit(1);
