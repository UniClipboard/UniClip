jest.mock('@/services/ClipboardManager', () => ({
  clipboardManager: {
    getClipboardContent: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('@/services/ClipboardMonitor', () => ({
  clipboardMonitor: {
    addCallback: jest.fn(),
    removeCallback: jest.fn(),
  },
}));

jest.mock('@/utils/index', () => ({
  isTextInvalid: jest.fn(() => false),
}));

import { SyncManager } from '@/services/SyncManager';
import { RoutedSyncClipboardClient } from '@/services/RoutedSyncClipboardClient';
import { SyncMode, ConflictResolution } from '@/types/sync';

describe('SyncManager route client', () => {
  it('uses the routed SyncClipboard client for multi-address servers', async () => {
    const manager = SyncManager.getInstance();

    await manager.initialize({
      server: {
        type: 'syncclipboard',
        url: 'https://clip.example.com',
        urls: ['https://clip.example.com', 'http://192.168.1.20:5033'],
        username: 'alice',
        password: 'secret',
      },
      mode: SyncMode.Manual,
      interval: 5000,
      conflictResolution: ConflictResolution.UseNewest,
      enableOfflineQueue: false,
      maxOfflineQueueSize: 100,
      syncLargeFiles: true,
      largeFileThreshold: 10 * 1024 * 1024,
      maxRetries: 3,
      retryDelay: 2000,
    });

    expect(manager.getAPIClient()).toBeInstanceOf(RoutedSyncClipboardClient);

    await manager.destroy();
  });
});
