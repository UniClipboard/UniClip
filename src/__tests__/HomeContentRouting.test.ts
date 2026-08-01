import fs from 'fs';
import path from 'path';

const controller = fs.readFileSync(
  path.resolve(__dirname, '../screens/useHomeController.ts'),
  'utf8'
);
const homeChrome = fs.readFileSync(path.resolve(__dirname, '../screens/HomeChrome.tsx'), 'utf8');
const topBarTypes = fs.readFileSync(
  path.resolve(__dirname, '../components/HomeTopBar.types.ts'),
  'utf8'
);
const topBars = ['android', 'ios'].map((platform) =>
  fs.readFileSync(path.resolve(__dirname, `../components/HomeTopBar.${platform}.tsx`), 'utf8')
);

describe('home content routing', () => {
  it('routes clipboard, image, and file sends through the unified content service', () => {
    expect(controller).toContain('getUnifiedContentService');
    expect(controller).toContain('.sendCurrentClipboard()');
    expect(controller).toContain('.sendImportedAsset(');
  });

  it('does not contain the retired upload paths', () => {
    expect(controller).not.toContain('getClipboardSyncService().triggerUpload()');
    expect(controller).not.toContain('BackgroundUploadManager.enqueue(');
  });

  it('waits for imported asset delivery before showing its final result', () => {
    expect(controller).toContain(
      'const sendResult = await getUnifiedContentService().sendImportedAsset('
    );
  });

  it('derives connection status from the P2P engine', () => {
    expect(controller).toContain('deriveP2pConnectionStatus');
    expect(controller).toContain('useUnifiedEngineStore');
    expect(controller).not.toContain('syncChannel');
    expect(controller).not.toContain('refreshSelectedConnection');
  });

  it('keeps a fixed My Space entry without a connection indicator', () => {
    for (const topBar of topBars) {
      expect(topBar).toContain("t('topBar.mySpace')");
      expect(topBar).toContain('onOpenSpace');
      expect(topBar).not.toContain('spaceLabel');
      expect(topBar).not.toContain('ConnectionStatusDot');
      expect(topBar).not.toContain('STATUS_STYLE');
      expect(topBar).not.toContain('CONNECTION_STATUS_TEXT');
    }

    expect(topBarTypes).not.toContain('connectionStatus');
    expect(topBarTypes).not.toContain('spaceLabel');
    expect(homeChrome).not.toContain('connectionStatus={c.connectionStatus}');

    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const home = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, `../i18n/locales/${locale}/home.json`), 'utf8')
      );
      expect(home.topBar.mySpace).toEqual(expect.any(String));
      expect(home.topBar.openSpaceA11y).not.toContain('{{space}}');
    }
  });
});
