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

const sheetSource = fs.readFileSync(
  path.join(__dirname, '..', 'screens', 'settings', 'android', 'SettingsConfirmationSheet.tsx'),
  'utf8'
);

describe('Android About update sheet', () => {
  it('reuses the shared sheet and scrolls only the release notes', () => {
    const sheet = getDownloadSourceSheetSource();

    expect(sheet).toContain('<SettingsConfirmationSheet');
    expect(sheet).toContain('scrollableBody={Boolean(localizedReleaseNotes)}');
    expect(sheet).not.toContain('<ModalBottomSheet');
    expect(sheet).not.toContain('verticalScroll');
  });

  it('keeps the actions outside the scroll container of the scrollable-body layout', () => {
    const start = sheetSource.indexOf('{scrollableBody ? (');
    const end = sheetSource.indexOf(') : (', start);
    const layout = sheetSource.slice(start, end);
    const scrollAt = layout.indexOf('verticalScroll()');
    const bodyEnd = layout.indexOf('{children}');
    const actionsAt = layout.indexOf('{actions}');

    expect(scrollAt).toBeGreaterThan(-1);
    expect(layout).toContain('weight(1)');
    expect(bodyEnd).toBeGreaterThan(scrollAt);
    // The action column is a sibling that starts after the scrolling body closed.
    expect(layout.slice(bodyEnd, actionsAt)).toContain('</Column>');
    expect(layout.match(/verticalScroll\(\)/g)).toHaveLength(1);
  });

  it('offers only R2 and GitHub download sources', () => {
    const sheet = getDownloadSourceSheetSource();

    expect(sheet).toContain("handleDownloadApk('r2'");
    expect(sheet).toContain("handleDownloadApk('github'");
    expect(sheet).not.toMatch(/gitee/i);
  });
});
