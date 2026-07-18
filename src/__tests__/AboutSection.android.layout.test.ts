/// <reference types="node" />

import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '..', 'screens', 'settings', 'AboutSection.tsx'),
  'utf8'
);

function getDownloadSourceSheetSource(): string {
  const start = source.indexOf('{downloadSourceSheet && (');
  const end = source.indexOf('{showCancelDownloadDialog &&', start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Android About update sheet', () => {
  it('keeps download actions reachable when release notes are long', () => {
    expect(getDownloadSourceSheetSource()).toContain('verticalScroll()');
  });
});
