import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('Android background clipboard modes', () => {
  const hasReadLogsPermission = jest.fn<() => boolean>();

  beforeEach(() => {
    jest.resetModules();
    hasReadLogsPermission.mockReset().mockReturnValue(false);

    jest.doMock('react-native', () => ({
      AppState: {
        currentState: 'background',
        addEventListener: jest.fn(() => ({ remove: jest.fn() })),
      },
      Linking: { openURL: jest.fn() },
      Platform: { OS: 'android' },
    }));
    jest.doMock('expo-application', () => ({
      applicationId: 'app.uniclipboard.android.dev',
    }));
    jest.doMock('expo-clipboard', () => ({
      setStringAsync: jest.fn<() => Promise<boolean>>(async () => true),
    }));
    jest.doMock('native-timer', () => ({
      setTimer: jest.fn(),
      clearTimer: jest.fn(),
    }));
    jest.doMock('@/stores/settingsStore', () => ({
      useSettingsStore: {
        getState: () => ({
          config: {
            clipboardAccessMethod: 'overlay-polling',
            enableClipboardOverlay: true,
          },
          setEnableClipboardOverlay: jest.fn<() => Promise<void>>(async () => {}),
        }),
      },
    }));
    jest.doMock('clipboard-overlay', () => ({
      hasOverlayPermission: jest.fn(() => true),
      hasReadLogsPermission,
      addClipboardChangeListener: jest.fn(() => ({ remove: jest.fn() })),
      startClipboardMonitor: jest.fn<() => Promise<boolean>>(async () => true),
      stopClipboardMonitor: jest.fn(),
      requestOverlayPermission: jest.fn(),
      isOverlayShowing: jest.fn(() => false),
      hideOverlayWindow: jest.fn(),
    }));
    jest.doMock('shizuku-clipboard', () => ({}));
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('allows no-ADB background reads in polling mode without starting an event monitor', async () => {
    const {
      getBackgroundClipboardAdapter,
      getClipboardAccessAdapter,
    } = require('@/utils/androidBackgroundClipboardAccess');
    const adapter = getClipboardAccessAdapter('overlay-polling');

    expect(getBackgroundClipboardAdapter('read')).toBe(adapter);
    expect(getBackgroundClipboardAdapter('monitor')).toBeNull();
    expect(adapter.isReady('read')).toBe(true);
    expect(adapter.isReady('write')).toBe(true);
    expect(adapter.isReady('monitor')).toBe(false);
    await expect(adapter.startMonitoring(jest.fn())).resolves.toBeNull();
    expect(adapter.getAuthorizationState()).toEqual({
      status: 'ready',
      monitoringStatus: 'ready',
      setupCommand: undefined,
    });
  });

  it('requires READ_LOGS for event detection but not for background writes', async () => {
    const { getClipboardAccessAdapter } = require('@/utils/androidBackgroundClipboardAccess');
    const adapter = getClipboardAccessAdapter('overlay-event');

    expect(adapter.isReady('monitor')).toBe(false);
    expect(adapter.isReady('read')).toBe(false);
    expect(adapter.isReady('write')).toBe(true);
    expect(adapter.getAuthorizationState().setupCommand).toContain('android.permission.READ_LOGS');

    await adapter.runTriggeredRead(async () => {
      expect(adapter.isReady('read')).toBe(true);
    });
    expect(adapter.isReady('read')).toBe(false);

    hasReadLogsPermission.mockReturnValue(true);
    expect(adapter.isReady('monitor')).toBe(true);
    expect(adapter.getAuthorizationState()).toEqual({
      status: 'ready',
      monitoringStatus: 'ready',
      setupCommand: undefined,
    });
  });
});
