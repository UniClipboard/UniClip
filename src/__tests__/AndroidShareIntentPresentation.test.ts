import fs from 'fs';
import path from 'path';

const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

describe('Android external-share presentation', () => {
  it('opens the Android share page in parsing mode for a new shared item', () => {
    const branches = [...app.matchAll(/if \(isShareIntentUrl\(url\)\) \{([\s\S]*?)\n      \}/g)];

    expect(branches).toHaveLength(2);
    for (const [, branch] of branches) {
      expect(branch).toContain(
        'setShareReceiveOverlay(useShareSheetStore.getState().beginParsing());'
      );
    }
  });
});
