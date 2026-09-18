import fs from 'fs';
import path from 'path';

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, '../components/ShareSendSheet', file), 'utf8');

const ios = read('ShareSendSheet.ios.tsx');
const android = read('ShareSendSheet.android.tsx');
const locales = ['en', 'zh', 'ru', 'pt-BR'].map((locale) =>
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../i18n/locales/${locale}/share.json`), 'utf8')
  )
);

describe('ShareSendSheet presentation', () => {
  it('opens the iOS sheet at full height by default', () => {
    expect(ios).toContain("presentationDetents(['large'])");
    expect(ios).not.toContain('fitToContents');
  });

  it('uses one sheet background behind the header, content, and footer on iOS', () => {
    expect(ios).toContain(
      "const SHEET_BACKGROUND = iosColors?.systemGroupedBackground ?? '#F2F2F7';"
    );
    expect(ios).toContain('background(SHEET_BACKGROUND)');
  });

  it('puts the shared-content section before target selection on both platforms', () => {
    expect(ios.indexOf('<ContentSection')).toBeLessThan(ios.indexOf('<TargetSection'));
    expect(android.indexOf('<ContentSection')).toBeLessThan(android.indexOf('<TargetSection'));
  });

  it('uses a compact preview and a clear bottom send action on iOS', () => {
    expect(ios).toContain('const IMAGE_PREVIEW_SIZE = 64;');
    expect(ios).toContain('resizable()');
    expect(ios).toContain("aspectRatio({ contentMode: 'fit' })");
    expect(ios).toContain('clipped()');
    expect(ios).toContain('<SendFooter c={c} />');
    expect(ios).not.toContain('function HeaderSendButton');
  });

  it('shows a filled success button while the iOS sheet is closing after a send', () => {
    const footer = ios.match(/function SendFooter[\s\S]*?\n}\n\nfunction ContentSection/)?.[0];

    expect(footer).toContain("t('send.success')");
    expect(footer).toContain('iosSaturatedButtonPalette(iosKindTints.image)');
    expect(footer).toContain('checkmark.circle.fill');
    expect(footer).not.toContain("t('send.done')");
  });

  it('anchors iOS device information left and the selection control right', () => {
    expect(ios).toContain('listRowInsets({ top: 8, bottom: 8, leading: 16, trailing: 16 })');
    const deviceRow = ios.match(/function TargetRow[\s\S]*?\n}\n\nconst styles/)?.[0];

    expect(deviceRow).toContain('<Spacer />');
    expect(deviceRow?.indexOf('<Spacer />')).toBeLessThan(
      deviceRow?.indexOf('checkmark.circle.fill')
    );
  });

  it('gives Android selected device rows full-row feedback and selection semantics', () => {
    expect(android).toContain('accessibilityState={{ selected }}');
    expect(android).toContain('selected && styles.targetRowSelected');
  });

  it('keeps Android share sheet content in the React Native view tree', () => {
    expect(android).not.toContain('AppCard');
    expect(android).not.toContain('AppProgressIndicator');
    expect(android).not.toContain('AppButton');
  });

  it('uses a full-screen Android share page that stays visible while parsing', () => {
    expect(android).toContain('<Modal');
    expect(android).toContain('isParsing');
    expect(android).not.toContain('AppBottomSheet');
  });

  it('uses the native full-row hit shape for iOS device selection', () => {
    expect(ios).toContain('contentShape(shapes.rectangle())');
    expect(ios).toContain('accessibilityValue(selected ?');
  });

  it('keeps an accessible refresh action beside the iOS target-list heading', () => {
    const targetSection = ios.match(/function TargetSection[\s\S]*?\n}\n\nfunction JobRow/)?.[0];

    expect(ios).toContain('onRefresh={c.refreshTargets}');
    expect(targetSection).toContain('systemImage="arrow.clockwise"');
    expect(targetSection).toContain("labelStyle('iconOnly')");
    expect(targetSection).toContain('frame({ minWidth: 44, minHeight: 44 })');
    expect(targetSection).toContain('disabled(isLoading)');
  });

  it('renders the active channel targets without device-only row types', () => {
    expect(ios).toContain('target.displayName');
    expect(android).toContain('target.displayName');
    expect(ios).toContain('target.detail');
    expect(android).toContain('target.detail');
    expect(ios).not.toContain('UnifiedSpaceDevice');
    expect(android).not.toContain('UnifiedSpaceDevice');
  });

  it('localizes LAN server target states in every supported language', () => {
    for (const messages of locales) {
      expect(messages.send.servers).toEqual(expect.any(String));
      expect(messages.send.noServers).toEqual(expect.any(String));
    }
  });
});
