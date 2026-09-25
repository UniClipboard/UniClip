import fs from 'fs';
import path from 'path';

import { resources } from '../i18n/resources';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

const settingsScreen = read('screens/SettingsScreen.ios.tsx');
const clipboardPage = read('screens/settings/ios/ClipboardAccessPage.tsx');
const guideSheet = read('screens/settings/ios/ClipboardSettingsGuideSheet.tsx');

type Tree = { [key: string]: string | Tree };

function lookup(tree: Tree, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree);
}

const GUIDE_STEPS = ['findApp', 'openPaste', 'chooseAllow'];

/** Every settingsPermissions key the page and sheet read, with step templates expanded. */
function usedKeys(): string[] {
  const keys = new Set<string>();
  for (const source of [clipboardPage, guideSheet]) {
    for (const match of source.matchAll(/\bt\(\s*[`']([^`']+)[`']/g)) {
      const key = match[1];
      if (key.includes('${step}')) {
        for (const step of GUIDE_STEPS) keys.add(key.replace('${step}', step));
      } else if (key.endsWith('.${key}')) {
        const prefix = key.slice(0, -'.${key}'.length);
        for (const labelMatch of guideSheet.matchAll(/label\('([^']+)'\)/g)) {
          keys.add(`${prefix}.${labelMatch[1]}`);
        }
      } else {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

describe('iOS clipboard access page and settings guide sheet', () => {
  it('lets the stable Settings host own the guide sheet, outside the pushed page', () => {
    const stackEnd = settingsScreen.indexOf('</NavigationStack>');
    expect(settingsScreen.indexOf('<ClipboardSettingsGuideSheet')).toBeGreaterThan(stackEnd);
    expect(settingsScreen).toContain('onOpenSettingsGuide={() => setClipboardGuideVisible(true)}');
    expect(clipboardPage).not.toMatch(/<(BottomSheet|Modal|Host|ClipboardSettingsGuideSheet)\b/);
  });

  it('opens the guide and system settings from full-width settings rows', () => {
    const guideRow = clipboardPage.match(
      /<SettingsNavRow\s+testID="clipboard-access-settings-guide"[\s\S]*?\/>/
    )?.[0];
    expect(guideRow).toContain('onPress={onOpenSettingsGuide}');
    const settingsRow = clipboardPage.match(
      /<SettingsNavRow\s+testID="clipboard-access-open-settings"[\s\S]*?\/>/
    )?.[0];
    expect(settingsRow).toContain('Linking.openSettings()');
  });

  it('never claims to know the permission value iOS keeps from apps', () => {
    expect(clipboardPage).not.toMatch(/StatusValue|permission(Status|State)/);
  });

  it('leaves the auto-push toggle to the Settings root page', () => {
    expect(clipboardPage).not.toContain('autoPushLocal');
  });

  it('draws outlines on containers instead of standalone shapes', () => {
    // A shape view carrying strokeBorder still fills with the foreground color,
    // which painted each illustration as a solid black card.
    const strokes = [...guideSheet.matchAll(/strokeBorder\(\{[^)]*\}\)/g)].map((m) => m[0]);
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes) {
      expect(stroke).toMatch(/shape: '(roundedRectangle|circle)'/);
    }
    expect(guideSheet).not.toMatch(/<RoundedRectangle[^>]*strokeBorder/);
  });

  it('localizes every string drawn in the illustrations', () => {
    expect(guideSheet).toContain('t(`clipboardAccess.guide.illustration.${key}`)');
    // The only literal label in the drawings is the brand name.
    const literalTitles = [...guideSheet.matchAll(/(?:title|backLabel)="([^"]+)"/g)];
    expect(literalTitles).toEqual([]);
    for (const label of [
      'settings',
      'apps',
      'search',
      'accessHeader',
      'pasteFromOtherApps',
      'ask',
      'deny',
      'allow',
    ]) {
      expect(guideSheet).toContain(`label('${label}')`);
    }
  });

  it('has a non-empty translation in every language for each key it uses', () => {
    const keys = usedKeys();
    expect(keys).toEqual(
      expect.arrayContaining([
        'clipboardAccess.guide.illustration.pasteFromOtherApps',
        'clipboardAccess.guide.steps.chooseAllow.tip',
        'clipboardAccess.prompt.allow',
      ])
    );
    for (const [language, namespaces] of Object.entries(resources)) {
      const tree = (namespaces as Record<string, Tree>).settingsPermissions;
      for (const key of keys) {
        const value = lookup(tree, key);
        expect({
          language,
          key,
          ok: typeof value === 'string' && value.trim().length > 0,
        }).toEqual({
          language,
          key,
          ok: true,
        });
      }
    }
  });
});
