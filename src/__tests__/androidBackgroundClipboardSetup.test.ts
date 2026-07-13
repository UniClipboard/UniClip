describe('Android background clipboard setup', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({
      AppState: { currentState: 'active', addEventListener: jest.fn() },
      Linking: { openURL: jest.fn().mockResolvedValue(undefined) },
      Platform: { OS: 'android' },
    }));
    jest.doMock('expo-application', () => ({ applicationId: 'app.uniclipboard.android.dev' }));
    jest.doMock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));
    jest.doMock('native-timer', () => ({ setTimer: jest.fn(), clearTimer: jest.fn() }));
    jest.doMock('@/stores/settingsStore', () => ({
      useSettingsStore: {
        getState: () => ({
          config: { clipboardAccessMethod: 'shizuku' },
          setEnableClipboardOverlay: jest.fn().mockResolvedValue(undefined),
        }),
      },
    }));
    jest.doMock('clipboard-overlay', () => ({}));
    jest.doMock('shizuku-clipboard', () => ({
      isShizukuAvailable: jest.fn(() => true),
      hasShizukuPermission: jest.fn(() => true),
      isBackgroundClipboardRestricted: jest.fn(() => true),
      resolveBackgroundClipboardRestriction: jest.fn().mockResolvedValue(true),
      addShizukuStateListener: jest.fn(() => ({ remove: jest.fn() })),
    }));
  });

  afterEach(() => jest.resetModules());

  it('lets the selected adapter resolve its own MIUI restriction', async () => {
    const shizuku = require('shizuku-clipboard');
    const { getClipboardAccessAdapter } = require('@/utils/androidBackgroundClipboardAccess');
    const adapter = getClipboardAccessAdapter('shizuku');

    await expect(adapter.continueSetup()).resolves.toBe('completed');
    expect(shizuku.resolveBackgroundClipboardRestriction).toHaveBeenCalledTimes(1);
  });
});
