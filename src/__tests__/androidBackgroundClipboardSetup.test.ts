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
    jest.doMock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));
    jest.doMock('native-timer', () => ({ setTimer: jest.fn(), clearTimer: jest.fn() }));
    jest.doMock('@/features/settings', () => ({
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

  describe('when Shizuku is not running', () => {
    const load = () => {
      const shizuku = require('shizuku-clipboard');
      shizuku.isShizukuAvailable.mockReturnValue(false);
      shizuku.isBackgroundClipboardRestricted.mockReturnValue(false);
      const launcher = require('expo-intent-launcher');
      const { Linking } = require('react-native');
      const { getClipboardAccessAdapter } = require('@/utils/androidBackgroundClipboardAccess');
      return { launcher, Linking, adapter: getClipboardAccessAdapter('shizuku') };
    };

    it('opens the installed Shizuku app instead of the web guide', async () => {
      const { launcher, Linking, adapter } = load();
      launcher.startActivityAsync.mockResolvedValue({});

      await expect(adapter.continueSetup()).resolves.toBe('waiting-for-return');
      expect(launcher.startActivityAsync).toHaveBeenCalledWith(
        'android.intent.action.MAIN',
        expect.objectContaining({
          packageName: 'moe.shizuku.privileged.api',
          className: 'moe.shizuku.manager.MainActivity',
        })
      );
      expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('falls back to the web guide only when Shizuku cannot be launched', async () => {
      const { launcher, Linking, adapter } = load();
      launcher.startActivityAsync.mockRejectedValue(new Error('not installed'));

      await expect(adapter.continueSetup()).resolves.toBe('waiting-for-return');
      expect(Linking.openURL).toHaveBeenCalledWith('https://shizuku.rikka.app/guide/setup/');
    });
  });
});
