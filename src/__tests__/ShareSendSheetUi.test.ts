import fs from 'fs';
import path from 'path';

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, '../components/ShareSendSheet', file), 'utf8');

const ios = read('ShareSendSheet.ios.tsx');
const android = read('ShareSendSheet.android.tsx');

describe('ShareSendSheet presentation', () => {
  it('opens the iOS sheet at full height by default', () => {
    expect(ios).toContain("presentationDetents(['large'])");
    expect(ios).not.toContain('fitToContents');
  });

  it('puts the shared-content section before device selection on both platforms', () => {
    expect(ios.indexOf('<ContentSection')).toBeLessThan(ios.indexOf('<DeviceSection'));
    expect(android.indexOf('<ContentSection')).toBeLessThan(android.indexOf('<DeviceSection'));
  });

  it('uses a compact preview and a clear bottom send action on iOS', () => {
    expect(ios).toContain('const IMAGE_PREVIEW_SIZE = 64;');
    expect(ios).toContain('resizable()');
    expect(ios).toContain("aspectRatio({ contentMode: 'fit' })");
    expect(ios).toContain('clipped()');
    expect(ios).toContain('<SendFooter c={c} />');
    expect(ios).not.toContain('function HeaderSendButton');
  });

  it('anchors iOS device information left and the selection control right', () => {
    expect(ios).toContain('listRowInsets({ top: 8, bottom: 8, leading: 16, trailing: 16 })');
    const deviceRow = ios.match(/function DeviceRow[\s\S]*?\n}\n\nconst styles/)?.[0];

    expect(deviceRow).toContain('<Spacer />');
    expect(deviceRow?.indexOf('<Spacer />')).toBeLessThan(
      deviceRow?.indexOf('checkmark.circle.fill')
    );
  });

  it('gives Android selected device rows full-row feedback and selection semantics', () => {
    expect(android).toContain('accessibilityState={{ selected }}');
    expect(android).toContain('selected && styles.deviceRowSelected');
  });

  it('uses the native full-row hit shape for iOS device selection', () => {
    expect(ios).toContain('contentShape(shapes.rectangle())');
    expect(ios).toContain('accessibilityValue(selected ?');
  });
});
