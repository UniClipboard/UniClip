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
      'screens/settings/ios/ServerListPage.tsx',
      'screens/settings/ios/StoragePage.tsx',
      'screens/settings/ios/KeyboardPage.tsx',
      'screens/settings/ios/SharePage.tsx',
      'screens/settings/ios/ClipboardAccessPage.tsx',
      'components/AddServerSheet.ios.tsx',
      'components/HistoryFilterSheet.ios.tsx',
      'components/ServerSwitcherModal.ios.tsx',
    ].map(readSource);

    for (const source of iosSheetSources) {
      expect(source).toContain('IosSheetPage');
      expect(source).not.toMatch(/<SheetHeader(\s|>)/);
    }
  });

  it('keeps Form list backgrounds aligned through the shared form helper', () => {
    const formSheetSources = [
      'screens/settings/ios/SettingsRootPage.tsx',
      'screens/settings/ios/ServerListPage.tsx',
      'components/AddServerSheet.ios.tsx',
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

  it('keeps text header actions adaptive instead of forcing them into icon slots', () => {
    const headerSource = readSource('components/ui/SheetHeader.ios.tsx');
    const addServerSource = readSource('components/AddServerSheet.ios.tsx');

    expect(addServerSource).toContain('left={');
    expect(addServerSource).toContain("t('action.cancel'");
    expect(addServerSource).toContain('right={');
    expect(addServerSource).toContain("t('action.save'");
    expect(headerSource).toContain('renderAdaptiveHeaderSide');
    expect(headerSource).toContain('leftSlots ?');
    expect(headerSource).toContain('rightSlots ?');
    expect(headerSource).toContain("renderHeaderButtonSlots(leftSlots, 'leading')");
    expect(headerSource).toContain("renderHeaderButtonSlots(rightSlots, 'trailing')");
    expect(headerSource).toContain('renderAdaptiveHeaderSide(left,');
    expect(headerSource).toContain('renderAdaptiveHeaderSide(right,');
    expect(headerSource).not.toContain('normalizeHeaderButtonSlots');
  });

  it('sizes add server text actions to match the sheet header controls', () => {
    const addServerSource = readSource('components/AddServerSheet.ios.tsx');
    const headerStart = addServerSource.indexOf('<IosSheetPage');
    const headerEnd = addServerSource.indexOf('<IosSheetForm>', headerStart);
    const headerSource = addServerSource.slice(headerStart, headerEnd);

    expect(addServerSource).toContain('controlSize');
    expect(headerSource).toContain("controlSize('large')");
    expect(headerSource.match(/controlSize\('large'\)/g)).toHaveLength(2);
    expect(headerSource).toContain("t('action.cancel'");
    expect(headerSource).toContain("t('action.save'");
  });

  it('routes icon-only sheet actions through fixed header slots', () => {
    const serverSwitcherSource = readSource('components/ServerSwitcherModal.ios.tsx');
    const historyFilterSource = readSource('components/HistoryFilterSheet.ios.tsx');

    expect(serverSwitcherSource).toContain('leftSlots={[');
    expect(serverSwitcherSource).toContain('rightSlots={[');
    expect(serverSwitcherSource).not.toMatch(/title="服务器"[\s\S]*?left=\{/);
    expect(serverSwitcherSource).not.toMatch(/title="服务器"[\s\S]*?right=\{/);
    expect(historyFilterSource).toContain('rightSlots={[');
    expect(historyFilterSource).toContain('systemName="checkmark"');
  });
});
