import fs from 'fs';
import path from 'path';

const controller = fs.readFileSync(
  path.resolve(__dirname, '../screens/useHomeController.ts'),
  'utf8'
);

describe('home content routing', () => {
  it('routes clipboard, image, and file sends through the selected content service', () => {
    expect(controller).toContain('getUnifiedContentService');
    expect(controller).toContain('.sendCurrentClipboard()');
    expect(controller).toContain('.sendImportedAsset(');
  });

  it('does not bypass the selected content service through LAN-only upload calls', () => {
    expect(controller).not.toContain('getClipboardSyncService().triggerUpload()');
    expect(controller).not.toContain('BackgroundUploadManager.enqueue(');
  });

  it('derives status and refresh from the selected sync connection', () => {
    expect(controller).toContain('deriveP2pConnectionStatus');
    expect(controller).toContain('refreshSelectedConnection');
    expect(controller).toContain('useUnifiedEngineStore');
    expect(controller).toContain("config?.syncChannel ?? 'p2p'");
  });

  it('does not expose LAN-only sync banners while P2P is selected', () => {
    expect(controller).toContain(
      "const visibleSyncState = syncChannel === 'lan' ? syncState : 'Idle';"
    );
    expect(controller).toContain('syncState: visibleSyncState');
  });
});
