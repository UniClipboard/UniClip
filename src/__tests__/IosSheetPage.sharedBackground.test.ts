import fs from 'fs';
import path from 'path';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('iOS sheet page shared background', () => {
  it('centralizes the grouped sheet background in shared UI helpers', () => {
    const pageSource = readSource('components/ui/IosSheetPage.ios.tsx');
    const indexSource = readSource('components/ui/index.ts');

    expect(pageSource).toContain('IosSheetPage');
    expect(pageSource).toContain('IosSheetForm');
    expect(pageSource).toContain('iosColors?.systemGroupedBackground');
    expect(pageSource).toContain('background(sheetPageBackgroundColor)');
    expect(pageSource).toContain('scrollContentBackground');
    expect(indexSource).toContain("export { IosSheetPage, IosSheetForm } from './IosSheetPage'");
  });

  it('uses the shared sheet page wrapper for every iOS sheet with a header', () => {
    const iosSheetSources = [
      'screens/settings/ios/SettingsRootPage.tsx',
      'screens/settings/ios/StoragePage.tsx',
      'screens/settings/ios/KeyboardPage.tsx',
      'screens/settings/ios/SharePage.tsx',
      'screens/settings/ios/ClipboardAccessPage.tsx',
      'components/HistoryFilterSheet.ios.tsx',
    ].map(readSource);

    for (const source of iosSheetSources) {
      expect(source).toContain('IosSheetPage');
      expect(source).not.toMatch(/<SheetHeader(\s|>)/);
    }
  });

  it('keeps Form list backgrounds aligned through the shared form helper', () => {
    const formSheetSources = [
      'screens/settings/ios/SettingsRootPage.tsx',
      'components/HistoryFilterSheet.ios.tsx',
    ].map(readSource);

    for (const source of formSheetSources) {
      expect(source).toContain('IosSheetForm');
      expect(source).not.toContain("Form modifiers={[listStyle('insetGrouped')]}");
    }
  });

  it('supports two fixed circular button slots on each side of sheet headers', () => {
    const headerSource = readSource('components/ui/SheetHeader.ios.tsx');
    const pageSource = readSource('components/ui/IosSheetPage.ios.tsx');
    const indexSource = readSource('components/ui/index.ts');

    expect(headerSource).toContain('leftSlots');
    expect(headerSource).toContain('rightSlots');
    expect(headerSource).toContain('HEADER_BUTTON_SLOT_COUNT = 2');
    expect(headerSource).toContain('HEADER_BUTTON_SLOT_SIZE = 44');
    expect(headerSource).toContain('renderHeaderButtonSlots');
    expect(headerSource).toContain('fillFrom:');
    expect(headerSource).toContain("fillFrom === 'trailing'");
    expect(headerSource).toContain('return [slots[1], slots[0]]');
    expect(pageSource).toContain('extends SheetHeaderProps');
    expect(pageSource).toContain('leftSlots={leftSlots}');
    expect(pageSource).toContain('rightSlots={rightSlots}');
    expect(indexSource).not.toContain('SheetHeaderIconButton');
  });

  it('routes icon-only sheet actions through fixed header slots', () => {
    const historyFilterSource = readSource('components/HistoryFilterSheet.ios.tsx');

    expect(historyFilterSource).toContain('rightSlots={[');
    expect(historyFilterSource).toContain('systemName="checkmark"');
  });
});
