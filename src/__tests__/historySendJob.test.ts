import type { ClipboardItem } from '@/types/clipboard';
import { canSendHistoryItem, createHistorySendJob } from '@/utils/historySendJob';

function item(overrides: Partial<ClipboardItem>): ClipboardItem {
  return {
    type: 'Text',
    text: 'hello',
    profileHash: 'HASH',
    hasData: false,
    timestamp: 1,
    starred: false,
    syncStatus: 1,
    version: 1,
    lastModified: 0,
    lastAccessed: 0,
    isDeleted: false,
    pinned: false,
    isLocalFileReady: true,
    ...overrides,
  } as ClipboardItem;
}

describe('historySendJob', () => {
  it('writes text history to a temporary payload tagged with the history hash', () => {
    const job = createHistorySendJob(item({}), 'text')!;
    expect(job).toMatchObject({ kind: 'text', historyProfileHash: 'HASH' });
    expect(job.fileUri).toContain('send_to/HASH.txt');
  });

  it('points image and file jobs at the history file itself', () => {
    const image = item({ type: 'Image', fileUri: 'file:///h/cat.png', dataName: 'cat.png' });
    expect(createHistorySendJob(image, 'image')).toMatchObject({
      kind: 'image',
      fileUri: 'file:///h/cat.png',
      displayName: 'cat.png',
      historyProfileHash: 'HASH',
    });
  });

  it('refuses content that is not on this device', () => {
    const remote = item({ type: 'File', fileUri: undefined, isLocalFileReady: false });
    expect(canSendHistoryItem(remote, 'file')).toBe(false);
    expect(createHistorySendJob(remote, 'file')).toBeNull();
  });
});
