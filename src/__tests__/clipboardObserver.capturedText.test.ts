import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('captured clipboard dispatch', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ AppState: { currentState: 'background' } }));
    jest.doMock('@/features/settings', () => ({
      useSettingsStore: {
        getState: () => ({
          config: { autoPushLocal: true, autoPushLocalInBackground: true },
          isTempDisabledBackgroundTasks: false,
        }),
      },
    }));
    jest.doMock('@/utils/syncDirectionPolicy', () => ({
      canAutoPushInBackground: () => true,
    }));
    jest.doMock('@/platform/network', () => ({ getCurrentNetworkContext: () => ({}) }));
    jest.doMock('@/features/transfer/internal/deliveryState', () => ({
      persistP2pDeliveryReport: jest.fn<() => Promise<void>>(async () => {}),
    }));
    jest.doMock('@/support/observability', () => ({
      createLogger: () => ({ info: jest.fn() }),
    }));
  });

  it.each([
    {
      type: 'Text',
      text: 'already captured while Android allowed the read',
      profileHash: 'local-text',
    },
    {
      type: 'Image',
      fileUri: 'file:///clipboard.png',
      profileHash: 'local-image',
    },
  ])(
    'asks the engine to observe a changed $type clipboard through the system clipboard',
    async (content) => {
      const {
        configureClipboardObserver,
        notifyDeviceClipboardChanged,
      } = require('@/features/transfer/internal/clipboardObserver');
      const observe = jest.fn().mockResolvedValue(null);
      configureClipboardObserver(observe);
      await notifyDeviceClipboardChanged(content);

      expect(observe).toHaveBeenCalledWith(true);
    }
  );
});
