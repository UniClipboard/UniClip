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

  it('passes captured text to the engine instead of asking it to read the clipboard again', async () => {
    const {
      configureClipboardObserver,
      notifyDeviceClipboardChanged,
    } = require('@/features/transfer/internal/clipboardObserver');
    const observe = jest.fn().mockResolvedValue(null);
    const content = {
      type: 'Text',
      text: 'already captured while Android allowed the read',
      profileHash: 'local-content',
    };

    configureClipboardObserver(observe);
    await notifyDeviceClipboardChanged(content);

    expect(observe).toHaveBeenCalledWith(content, true);
  });
});
