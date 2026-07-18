describe('ClipboardMonitor Shizuku events', () => {
  let startAdapterMonitor: jest.Mock;
  let setTimer: jest.Mock;
  let appStateHandler: ((state: string) => void) | null;

  beforeEach(() => {
    jest.resetModules();
    startAdapterMonitor = jest.fn().mockResolvedValue({ remove: jest.fn() });
    setTimer = jest.fn(() => 'polling');
    appStateHandler = null;

    jest.doMock('react-native', () => ({
      AppState: {
        currentState: 'background',
        addEventListener: jest.fn((_event: string, handler: (state: string) => void) => {
          appStateHandler = handler;
          return { remove: jest.fn() };
        }),
      },
      Platform: { OS: 'android' },
    }));
    jest.doMock('native-timer', () => ({ setTimer, clearTimer: jest.fn() }));
    jest.doMock('@/stores/settingsStore', () => ({
      useSettingsStore: {
        getState: () => ({ config: { clipboardAccessMethod: 'shizuku' } }),
      },
    }));
    jest.doMock('@/utils/androidBackgroundClipboardAccess', () => ({
      getBackgroundClipboardAdapter: jest.fn(() => ({
        method: 'shizuku',
        isReady: jest.fn(() => true),
        startMonitoring: startAdapterMonitor,
        runTriggeredRead: async (read: () => Promise<unknown>) => read(),
        getString: jest.fn(),
        setString: jest.fn(),
        hasString: jest.fn(),
        hasImage: jest.fn(),
        saveImageToFile: jest.fn(),
      })),
    }));
    jest.doMock('shizuku-clipboard', () => ({
      isShizukuAvailable: jest.fn(() => true),
      hasShizukuPermission: jest.fn(() => true),
      addClipboardChangeListener: jest.fn(() => ({ remove: jest.fn() })),
      startClipboardMonitor: jest.fn().mockResolvedValue(true),
      stopClipboardMonitor: jest.fn(),
    }));
    jest.doMock('clipboard-overlay', () => ({
      hasReadLogsPermission: jest.fn(() => false),
      addClipboardChangeListener: jest.fn(),
      startClipboardMonitor: jest.fn(),
      stopClipboardMonitor: jest.fn(),
    }));
    jest.doMock('@/services/ClipboardManager', () => ({
      ClipboardManager: jest.fn(),
      clipboardManager: {
        getClipboardContent: jest.fn().mockResolvedValue(null),
        resetLastProfileHash: jest.fn(),
      },
    }));
  });

  afterEach(() => jest.resetModules());

  it('starts Shizuku events instead of the polling fallback', async () => {
    const { ClipboardMonitor } = require('@/services/ClipboardMonitor');
    const manager = {
      getClipboardContent: jest.fn().mockResolvedValue(null),
      buildTextContent: jest.fn(),
      resetLastProfileHash: jest.fn(),
    };

    const monitor = new ClipboardMonitor(manager);
    await monitor.start();

    expect(startAdapterMonitor).toHaveBeenCalledTimes(1);
    expect(setTimer).not.toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Number),
      'clipboard_monitor'
    );
  });

  it('reads the clipboard immediately when Android returns to the foreground', async () => {
    const { ClipboardMonitor } = require('@/services/ClipboardMonitor');
    const manager = {
      getClipboardContent: jest.fn().mockResolvedValue(null),
      buildTextContent: jest.fn(),
      resetLastProfileHash: jest.fn(),
    };
    const monitor = new ClipboardMonitor(manager);
    await monitor.start();

    appStateHandler?.('active');
    await Promise.resolve();

    expect(manager.getClipboardContent).toHaveBeenCalledTimes(1);
  });
});
