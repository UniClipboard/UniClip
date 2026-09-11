import fs from 'node:fs';
import path from 'node:path';
const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
describe('history E2E uses real shared controls', () => {
  it.each(['ios', 'android'])('identifies full cards and action rows on %s', (platform) => {
    expect(read(`components/ClipboardCard.${platform}.tsx`)).toContain('testID={`history-card-${item.profileHash}`}');
    expect(read(`components/CardContextOverlay.${platform}.tsx`)).toContain('testID={`history-action-${action.key}`}');
    expect(read(`components/CardContextOverlay.${platform}.tsx`)).toContain('testID="history-preview-text"');
  });
  it.each(['screens/ios/HomeSearchDock.tsx', 'components/HomeTopBar.android.tsx'])('identifies real search entry and input in %s', (file) => {
    const source = read(file);
    for (const id of ['history-search-open', 'history-search-input', 'history-search-close']) {
      expect(source).toContain(`testID="${id}"`);
    }
  });
});
