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
});
