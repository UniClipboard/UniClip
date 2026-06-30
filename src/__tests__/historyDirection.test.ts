import { createDefaultClipboardItem, HistorySyncStatus } from '@/types/clipboard';
import { getHistoryDirectionIndicator } from '@/utils/historyDirection';

function textItem(overrides = {}) {
  return createDefaultClipboardItem({
    type: 'Text',
    text: 'hello',
    profileHash: 'HASH',
    hasData: false,
    timestamp: 1000,
    ...overrides,
  });
}

describe('getHistoryDirectionIndicator', () => {
  it('shows pending upload for local history before it is synced', () => {
    expect(getHistoryDirectionIndicator(textItem())).toBe('pendingUpload');
  });

  it('shows upload only after local history is synced', () => {
    expect(
      getHistoryDirectionIndicator(
        textItem({
          syncStatus: HistorySyncStatus.Synced,
        })
      )
    ).toBe('upload');
  });

  it('shows download for pulled history', () => {
    expect(
      getHistoryDirectionIndicator(
        textItem({
          syncStatus: HistorySyncStatus.Synced,
          from: 'server',
        })
      )
    ).toBe('download');
  });

  it('shows download for remote metadata that still needs a local file', () => {
    expect(
      getHistoryDirectionIndicator(
        textItem({
          syncStatus: HistorySyncStatus.Synced,
          isLocalFileReady: false,
        })
      )
    ).toBe('download');
  });

  it('treats local edits as upload even when an old remote marker existed before re-save', () => {
    expect(
      getHistoryDirectionIndicator(
        textItem({
          syncStatus: HistorySyncStatus.LocalOnly,
          from: undefined,
        })
      )
    ).toBe('pendingUpload');
  });
});
