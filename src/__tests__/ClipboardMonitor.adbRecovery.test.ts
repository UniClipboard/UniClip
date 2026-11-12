describe('ADB clipboard detection failures', () => {
  it('keeps ADB mode event-only when its native listener cannot start', async () => {
    jest.resetModules();
    const setTimer = jest.fn(() => 'timer');
    jest.doMock('react-native', () => ({
      AppState: { currentState: 'background', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
      Platform: { OS: 'android' },
    }));
    jest.doMock('native-timer', () => ({ setTimer, clearTimer: jest.fn() }));
    jest.doMock('@/features/settings', () => ({
      useSettingsStore: {
        getState: () => ({ config: { clipboardAccessMethod: 'overlay-event' } }),
      },
    }));
    jest.doMock('@/utils/androidBackgroundClipboardAccess', () => ({
      getBackgroundClipboardAdapter: () => ({
        startMonitoring: jest.fn().mockRejectedValue(new Error('log reader unavailable')),
      }),
    }));
    jest.doMock('@/features/clipboard/internal/clipboardManager', () => ({
      ClipboardManager: jest.fn(),
      clipboardManager: { getClipboardContent: jest.fn(), resetLastProfileHash: jest.fn() },
    }));
    const { ClipboardMonitor } = require('@/features/clipboard/internal/clipboardMonitor');
    const monitor = new ClipboardMonitor({ getClipboardContent: jest.fn(), resetLastProfileHash: jest.fn() });

    await monitor.start();
    expect(setTimer).not.toHaveBeenCalledWith(expect.any(Function), expect.any(Number), 'clipboard_monitor');
    monitor.resumePolling();
    expect(setTimer).not.toHaveBeenCalledWith(expect.any(Function), expect.any(Number), 'clipboard_monitor');
    monitor.stop();
    jest.resetModules();
  });
});
