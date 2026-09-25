import fs from 'fs';
import path from 'path';

import { resources } from '../i18n/resources';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

const settingsScreen = read('screens/SettingsScreen.ios.tsx');
const keyboardPage = read('screens/settings/ios/KeyboardPage.tsx');
const sharePage = read('screens/settings/ios/SharePage.tsx');
const shareGuide = read('screens/settings/ios/ShareFavoritesGuideSheet.tsx');
const clipboardGuide = read('screens/settings/ios/ClipboardSettingsGuideSheet.tsx');

type Tree = { [key: string]: string | Tree };

function lookup(tree: Tree, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree);
}

const SHARE_GUIDE_STEPS = ['openSheet', 'findMore', 'addFavorite', 'moveToTop'];
const FLOW_STEPS = ['tapShare', 'pickApp', 'chooseDevices'];
const CONTENT_TYPES = ['text', 'links', 'images', 'files'];

/** Every settingsIos key the pages and sheet read, with templates expanded. */
function usedKeys(): string[] {
  const keys = new Set<string>();
  const expand = (key: string, source: string) => {
    if (key.includes('${step}')) {
      for (const step of SHARE_GUIDE_STEPS) keys.add(key.replace('${step}', step));
    } else if (key.includes('${step.key}')) {
      for (const step of FLOW_STEPS) keys.add(key.replace('${step.key}', step));
    } else if (key.includes('${type.key}')) {
      for (const type of CONTENT_TYPES) keys.add(key.replace('${type.key}', type));
    } else if (key.endsWith('.${key}')) {
      const prefix = key.slice(0, -'.${key}'.length);
      for (const labelMatch of source.matchAll(/label\('([^']+)'\)/g)) {
        keys.add(`${prefix}.${labelMatch[1]}`);
      }
    } else {
      keys.add(key);
    }
  };
  for (const source of [keyboardPage, sharePage, shareGuide]) {
    for (const match of source.matchAll(/\bt\(\s*[`']([^`']+)[`']/g)) expand(match[1], source);
  }
  return [...keys];
}

describe('iOS Share page and Pin to Favorites guide sheet', () => {
  it('lets the stable Settings host own the guide sheet, outside the pushed page', () => {
    const stackEnd = settingsScreen.indexOf('</NavigationStack>');
    expect(settingsScreen.indexOf('<ShareFavoritesGuideSheet')).toBeGreaterThan(stackEnd);
    expect(settingsScreen).toContain('onOpenFavoritesGuide={() => setShareGuideVisible(true)}');
    expect(sharePage).not.toMatch(/<(BottomSheet|Modal|Host|ShareFavoritesGuideSheet)\b/);
  });

  it('opens the guide from a full-width settings row', () => {
    const row = sharePage.match(/<SettingsNavRow\s+testID="share-favorites-guide"[\s\S]*?\/>/)?.[0];
    expect(row).toContain('onPress={onOpenFavoritesGuide}');
  });

  it('describes the hand-off to UniClip instead of promising a send without it', () => {
    const en = (resources.en as Record<string, Tree>).settingsIos;
    expect(lookup(en, 'share.hero.description')).toMatch(/UniClip opens/);
    expect(JSON.stringify(lookup(en, 'share'))).not.toMatch(/without switching/);
  });

  it('shares the guide scaffold and drawing primitives with the clipboard guide', () => {
    for (const guide of [shareGuide, clipboardGuide]) {
      expect(guide).toContain('<SettingsGuideSheet');
      expect(guide).not.toMatch(/<BottomSheet\b/);
    }
    expect(sharePage).toContain('<ShareSheetMock highlight="uniclip" />');
  });

  it('draws outlines on containers instead of standalone shapes', () => {
    const strokes = [...shareGuide.matchAll(/strokeBorder\(\{[^)]*\}\)/g)].map((m) => m[0]);
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes) {
      expect(stroke).toMatch(/shape: '(roundedRectangle|circle)'/);
    }
    expect(shareGuide).not.toMatch(/<(RoundedRectangle|Circle)[^>]*strokeBorder/);
  });
});

describe('iOS Keyboard page', () => {
  it('shows one checklist whose steps carry their own status', () => {
    expect(keyboardPage.match(/<SetupStepRow\b/g)).toHaveLength(3);
    expect(keyboardPage).not.toMatch(/StatusValue|GuideStepRow|LabeledContent/);
  });

  it('puts the Open iOS Settings button on the page background, not in a card', () => {
    const buttonSection = keyboardPage.slice(
      keyboardPage.indexOf('{ready ? null : ('),
      keyboardPage.indexOf('testID="keyboard-open-settings"')
    );
    expect(buttonSection).toContain("listRowBackground('clear')");
  });

  it('shows the keyboard as a silent looping video matching the appearance', () => {
    expect(keyboardPage).toContain('<KeyboardDemoVideo />');
    for (const appearance of ['light', 'dark']) {
      const file = `assets/videos/keyboard-paste-loop-${appearance}.mp4`;
      expect(keyboardPage).toContain(`../../../../${file}`);
      expect(fs.existsSync(path.resolve(__dirname, '../..', file))).toBe(true);
    }
    const player = read('screens/settings/ios/KeyboardDemoVideoPlayer.tsx');
    expect(player).toContain('p.loop = true;');
    expect(player).toContain('p.muted = true;');
    // Never pause the user's music for a settings illustration.
    expect(player).toContain("p.audioMixingMode = 'mixWithOthers';");
    expect(player).toContain('nativeControls={false}');
  });

  it('keeps the page loading on dev clients built without expo-video', () => {
    // A static import would throw there and take the whole Settings tab down.
    expect(keyboardPage).not.toMatch(/from 'expo-video'/);
    expect(keyboardPage).toMatch(
      /requireOptionalNativeModule\('ExpoVideo'\)\s*\?\s*require\('\.\/KeyboardDemoVideoPlayer'\)/
    );
    expect(keyboardPage).toContain('if (!DemoVideoPlayer) return null;');
  });

  it('offers the key feedback switches only once the keyboard is added', () => {
    expect(keyboardPage).toContain('{keyboard.added ? <KeyFeedbackSection /> : null}');
  });

  it('keeps the checklist in place when the keyboard is detected while the page is open', () => {
    expect(keyboardPage).toContain('ready && !sawSetup ? (');
    expect(keyboardPage).toContain('<LiveCheck detected={ready}');
  });

  it('keeps step 3 pending while Full Access is known to be off, then checks live', () => {
    // Board 2: step 2 asks for Full Access and step 3 waits. The live check
    // opens once a fresh reading is impossible: never opened, or back from Settings.
    expect(keyboardPage).toMatch(/keyboard\.added && backFromSettings/);
    // Only a heartbeat taken after the trip to Settings confirms Full Access.
    expect(keyboardPage).toContain('confirmedAt > backFromSettingsAtMs');
    expect(keyboardPage).toMatch(
      /checking\s*\?\s*\{ state: 'active' \}\s*:\s*\{ state: 'pending' \}/
    );
    expect(keyboardPage).toContain(
      "steps[1].state === 'active' && !checking ? <FullAccessNotes />"
    );
  });

  it('shows the "cannot add for you" hint only before the keyboard is added', () => {
    expect(keyboardPage).toMatch(
      /keyboard\.added \? null : \(\s*<SwiftUIText[\s\S]*?keyboard\.openSettingsHint/
    );
  });

  it('draws the key feedback switches as settings rows with colored tiles', () => {
    expect(keyboardPage.match(/<IconToggleRow\b/g)).toHaveLength(2);
    expect(keyboardPage).not.toMatch(/<SettingsToggle\b/);
  });

  it('opens iOS keyboard settings from a full-width settings row once ready', () => {
    const row = keyboardPage.match(
      /<SettingsNavRow\s+testID="keyboard-system-settings"[\s\S]*?\/>/
    )?.[0];
    expect(row).toContain('Linking.openSettings()');
  });
});

describe('iOS extension page strings', () => {
  it('has a non-empty translation in every language for each key the pages use', () => {
    const keys = usedKeys();
    expect(keys).toEqual(
      expect.arrayContaining([
        'keyboard.setup.switch.detected',
        'share.guide.steps.moveToTop.description',
        'share.guide.illustration.suggestions',
        'share.flow.chooseDevices',
        'share.worksWith.files',
      ])
    );
    for (const [language, namespaces] of Object.entries(resources)) {
      const tree = (namespaces as Record<string, Tree>).settingsIos;
      for (const key of keys) {
        const value = lookup(tree, key);
        expect({
          language,
          key,
          ok: typeof value === 'string' && value.trim().length > 0,
        }).toEqual({ language, key, ok: true });
      }
    }
  });
});
