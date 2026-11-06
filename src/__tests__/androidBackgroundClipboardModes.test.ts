import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { setImmediate } from 'node:timers';

describe('Android background clipboard modes', () => {
  const hasReadLogsPermission = jest.fn<() => boolean>();
  const isClipboardMonitoring = jest.fn<() => boolean>();
  let appStateListeners: Array<(state: string) => void>;

  beforeEach(() => {
    jest.resetModules();
    hasReadLogsPermission.mockReset().mockReturnValue(false);
    isClipboardMonitoring.mockReset().mockReturnValue(true);
    appStateListeners = [];

    jest.doMock('react-native', () => ({
      AppState: {
        currentState: 'background',
        addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
          appStateListeners.push(listener);
          return { remove: () => {
            appStateListeners = appStateListeners.filter((item) => item !== listener);
          } };
        }),
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
    jest.doMock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));
    jest.doMock('native-timer', () => ({
      setTimer: jest.fn(),
      clearTimer: jest.fn(),
    }));
    jest.doMock('@/features/settings', () => ({
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
      isClipboardMonitoring,
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

  it('recovers an ended ADB listener on foreground without a permission or mode change', async () => {
    hasReadLogsPermission.mockReturnValue(true);
    const overlay = require('clipboard-overlay');
    const { AppState } = require('react-native');
    const { getClipboardAccessAdapter } = require('@/utils/androidBackgroundClipboardAccess');
    const monitor = await getClipboardAccessAdapter('overlay-event').startMonitoring(jest.fn());

    isClipboardMonitoring.mockReturnValue(false);
    AppState.currentState = 'active';
    for (const listener of [...appStateListeners]) listener('active');
    await new Promise(setImmediate);

    expect(overlay.startClipboardMonitor).toHaveBeenCalledTimes(2);
    monitor.remove();
  });

  it('does not restart a healthy or explicitly removed ADB listener on foreground', async () => {
    hasReadLogsPermission.mockReturnValue(true);
    const overlay = require('clipboard-overlay');
    const { AppState } = require('react-native');
    const { getClipboardAccessAdapter } = require('@/utils/androidBackgroundClipboardAccess');
    const monitor = await getClipboardAccessAdapter('overlay-event').startMonitoring(jest.fn());

    AppState.currentState = 'active';
    for (const listener of [...appStateListeners]) listener('active');
    await Promise.resolve();
    expect(overlay.startClipboardMonitor).toHaveBeenCalledTimes(1);

    monitor.remove();
    isClipboardMonitoring.mockReturnValue(false);
    for (const listener of [...appStateListeners]) listener('active');
    await Promise.resolve();
    expect(overlay.startClipboardMonitor).toHaveBeenCalledTimes(1);
  });

  it('finishes an old native stop before starting a replacement reader', async () => {
    hasReadLogsPermission.mockReturnValue(true);
    const overlay = require('clipboard-overlay');
    const { getClipboardAccessAdapter } = require('@/utils/androidBackgroundClipboardAccess');
    const adapter = getClipboardAccessAdapter('overlay-event');
    const first = await adapter.startMonitoring(jest.fn());
    let finishStop!: (value: boolean) => void;
    overlay.stopClipboardMonitor.mockImplementation(() => new Promise<boolean>((resolve) => {
      finishStop = resolve;
    }));
    first.remove();
    const replacement = adapter.startMonitoring(jest.fn());
    await new Promise(setImmediate);
    expect(overlay.startClipboardMonitor).toHaveBeenCalledTimes(1);
    finishStop(true);
    const second = await replacement;
    expect(overlay.startClipboardMonitor).toHaveBeenCalledTimes(2);
    first.remove();
    expect(overlay.stopClipboardMonitor).toHaveBeenCalledTimes(1);
    overlay.stopClipboardMonitor.mockResolvedValue(true);
    second.remove();
    await new Promise(setImmediate);
  });
});
