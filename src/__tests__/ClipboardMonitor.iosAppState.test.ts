describe('ClipboardMonitor iOS app state handling', () => {
  let appStateHandler: ((state: string) => void) | null;
  let clearTimer: jest.Mock;
  let setTimer: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    appStateHandler = null;
    clearTimer = jest.fn();
    setTimer = jest.fn((_callback: () => void, _interval: number, tag?: string) => tag ?? 'timer');

    jest.doMock('native-timer', () => ({
      setTimer,
      clearTimer,
    }));

    jest.doMock('react-native', () => ({
      AppState: {
        currentState: 'active',
        addEventListener: jest.fn((_event: string, handler: (state: string) => void) => {
          appStateHandler = handler;
          return { remove: jest.fn() };
        }),
      },
      Platform: { OS: 'ios' },
    }));

    jest.doMock('@/stores/settingsStore', () => ({
      useSettingsStore: {
        getState: () => ({
          config: {
            enableBackgroundTasks: false,
            enableBackgroundUpload: false,
          },
        }),
      },
    }));

    jest.doMock('../services/ClipboardManager', () => ({
      ClipboardManager: jest.fn(),
      clipboardManager: {
        getClipboardContent: jest.fn().mockResolvedValue(null),
        resetLastProfileHash: jest.fn(),
      },
    }));
  });

  afterEach(() => {
    jest.dontMock('native-timer');
    jest.dontMock('react-native');
    jest.dontMock('@/stores/settingsStore');
    jest.dontMock('../services/ClipboardManager');
  });

  it('does not pause polling for the transient inactive state caused by the iOS paste prompt', async () => {
    const { ClipboardMonitor } = require('../services/ClipboardMonitor');
    const manager = {
      getClipboardContent: jest.fn().mockResolvedValue(null),
      resetLastProfileHash: jest.fn(),
    };
    const monitor = new ClipboardMonitor(manager, {
      pollingInterval: 1000,
      stopOnBackground: true,
      debounceDelay: 300,
    });

    await monitor.start();
    clearTimer.mockClear();

    appStateHandler?.('inactive');

    expect(clearTimer).not.toHaveBeenCalled();

    appStateHandler?.('background');

    expect(clearTimer).toHaveBeenCalledWith('clipboard_monitor');
  });

  it('reads the clipboard immediately when the app returns to the foreground', async () => {
    const { ClipboardMonitor } = require('../services/ClipboardMonitor');
    const manager = {
      getClipboardContent: jest.fn().mockResolvedValue(null),
      resetLastProfileHash: jest.fn(),
    };
    const monitor = new ClipboardMonitor(manager, {
      pollingInterval: 1000,
      stopOnBackground: true,
      debounceDelay: 300,
    });

    await monitor.start();
    appStateHandler?.('background');
    appStateHandler?.('active');
    await Promise.resolve();

    expect(manager.getClipboardContent).toHaveBeenCalledTimes(1);
  });
});
