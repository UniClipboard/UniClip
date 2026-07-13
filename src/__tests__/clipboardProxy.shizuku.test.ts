describe('clipboardProxy background adapter routing', () => {
  const loadProxy = (adapterReady: boolean) => {
    jest.resetModules();

    const directGet = jest.fn().mockResolvedValue('direct');
    const adapterGet = jest.fn().mockResolvedValue('adapter');
    const backgroundAdapter = {
      method: 'shizuku' as const,
      isReady: () => true,
      startMonitoring: jest.fn(),
      runTriggeredRead: async <T>(read: () => Promise<T>) => read(),
      getString: adapterGet,
      setString: jest.fn(),
      hasString: jest.fn(),
      hasImage: jest.fn(),
      saveImageToFile: jest.fn(),
    };

    jest.doMock('react-native', () => ({
      AppState: { currentState: 'background', addEventListener: jest.fn() },
      Platform: { OS: 'android' },
    }));
    jest.doMock('expo-clipboard', () => ({
      getStringAsync: directGet,
      setStringAsync: jest.fn(),
      hasStringAsync: jest.fn(),
      hasImageAsync: jest.fn(),
      getImageAsync: jest.fn(),
    }));
    jest.doMock('@/utils/androidBackgroundClipboardAccess', () => ({
      getBackgroundClipboardAdapter: jest.fn(() => (adapterReady ? backgroundAdapter : null)),
    }));
    jest.doMock('@/stores/settingsStore', () => ({
      useSettingsStore: { getState: () => ({ config: {} }) },
    }));
    jest.doMock('clipboard-overlay', () => ({
      getStringViaOverlay: jest.fn().mockResolvedValue('overlay'),
      hasOverlayPermission: jest.fn(() => true),
      isOverlayShowing: jest.fn(() => false),
      showOverlayWindow: jest.fn(),
      hideOverlayWindow: jest.fn(),
      setDebugMode: jest.fn(),
      setMaxRetries: jest.fn(),
    }));
    jest.doMock('shizuku-clipboard', () => ({
      getStringViaShizuku: jest.fn().mockResolvedValue('shizuku'),
      isShizukuAvailable: jest.fn(() => true),
      hasShizukuPermission: jest.fn(() => true),
    }));
    jest.doMock('native-timer', () => ({ setTimer: jest.fn(), clearTimer: jest.fn() }));
    jest.doMock('android-util', () => ({ nativeSaveClipboardImageToFile: jest.fn() }));

    return {
      proxy: require('@/utils/clipboardProxy') as typeof import('@/utils/clipboardProxy'),
      directGet,
      adapterGet,
    };
  };

  afterEach(() => jest.resetModules());

  it('delegates background reads to the selected adapter', async () => {
    const { proxy, directGet, adapterGet } = loadProxy(true);

    await expect(proxy.getStringAsync()).resolves.toBe('adapter');
    expect(adapterGet).toHaveBeenCalledTimes(1);
    expect(directGet).not.toHaveBeenCalled();
  });

  it('uses direct access when no background adapter is ready', async () => {
    const { proxy, directGet, adapterGet } = loadProxy(false);

    await expect(proxy.getStringAsync()).resolves.toBe('direct');
    expect(adapterGet).not.toHaveBeenCalled();
    expect(directGet).toHaveBeenCalledTimes(1);
  });
});
