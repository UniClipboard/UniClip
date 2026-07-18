/// <reference types="node" />

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useSettingsStore } from '../stores/settingsStore';
import { reconcileSyncEngineAppState, useSyncEngineStore } from '../stores/syncEngineStore';
import { SyncEngine } from '../services/SyncEngine';
import { AppState } from 'react-native';

interface CapturedEngineOptions {
  getActiveServer: () => unknown;
  getSettings: () => { autoPushLocal: boolean };
  getDeviceClipboard: () => Promise<unknown>;
  applyToDevice: (meta: Record<string, unknown>, payload?: ArrayBuffer) => Promise<void>;
}

interface MockEngineInstance {
  start: jest.Mock;
  stop: jest.Mock;
  notifyLocalChanged: jest.Mock;
  pushRecordExplicit: jest.Mock;
}

const getEngineMock = () => SyncEngine as unknown as jest.Mock;
const getEngineOptions = () => getEngineMock().mock.calls[0][0] as CapturedEngineOptions;
const getEngineInstance = () => getEngineMock().mock.results[0].value as MockEngineInstance;
const getAppStateListener = () =>
  (AppState.addEventListener as unknown as jest.Mock).mock.calls.find(
    ([eventName]) => eventName === 'change'
  )?.[1] as ((state: string) => void) | undefined;

jest.mock('@/services/SyncEngine', () => ({
  SyncEngine: jest.fn().mockImplementation((options: unknown) => ({
    options,
    init: jest.fn(async () => undefined),
    start: jest.fn(),
    stop: jest.fn(),
    setSceneInactive: jest.fn(),
    destroy: jest.fn(),
    addListener: jest.fn(),
    getStatus: jest.fn(),
    notifyLocalChanged: jest.fn(),
    pushRecordExplicit: jest.fn(async () => undefined),
    applyStagedEntry: jest.fn(),
    explicitRefresh: jest.fn(),
    acknowledgeLoop: jest.fn(),
    applySettings: jest.fn(),
    handleServerChanged: jest.fn(),
    handleNetworkChanged: jest.fn(),
    restartSse: jest.fn(),
  })),
}));

jest.mock('@/services/ClipboardManager', () => ({
  clipboardManager: {
    getClipboardContent: jest.fn(async () => null),
    setImageContent: jest.fn(async () => undefined),
  },
}));

jest.mock('@/services/ClipboardMonitor', () => ({
  clipboardMonitor: {
    addCallback: jest.fn(),
    removeCallback: jest.fn(),
    pausePolling: jest.fn(),
    resumePolling: jest.fn(),
    setLastContent: jest.fn(async () => undefined),
  },
}));

jest.mock('@/utils/clipboardProxy', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));

jest.mock('@/utils/fileStorage', () => ({
  saveHistoryFile: jest.fn(async () => 'file:///history/a.zip'),
}));

jest.mock('@/stores/historyStore', () => ({
  useHistoryStore: {
    getState: () => ({
      addItem: jest.fn(async (item: unknown) => item),
    }),
  },
}));

// activate_clipboard / clipboard_history 的内存桩:writeActivate / getDeviceClipboard
// 走真实逻辑,只把 SQLite 换成进程内的单行寄存器 + Map。
jest.mock('@/services/db/activateRepository', () => {
  let row: any = null;
  return {
    activateRepository: {
      get: jest.fn(async () => row),
      upsert: jest.fn(
        async (profileHash: string, contentId: string | null, activatedAtMs: number) => {
          row = { profileHash, contentId, activatedAtMs };
        }
      ),
      clear: jest.fn(async () => {
        row = null;
      }),
    },
  };
});

jest.mock('@/services/db/historyRepository', () => {
  const map = new Map<string, any>();
  return {
    historyRepository: {
      getByProfileHash: jest.fn(async (h: string) => map.get(h.toLowerCase()) ?? null),
      replace: jest.fn(async (item: any) => {
        map.set(item.profileHash.toLowerCase(), item);
      }),
    },
  };
});

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Platform: {
    OS: 'ios',
  },
}));

describe('syncEngineStore route config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSyncEngineStore.getState().stop();
    (AppState as { currentState: string }).currentState = 'active';
    useSettingsStore.setState({
      config: {
        servers: [
          {
            type: 'syncclipboard',
            name: 'Home',
            url: 'https://clip.example.com',
            urls: ['https://clip.example.com', 'http://192.168.1.20:5033'],
            username: 'alice',
            password: 'secret',
          },
        ],
        activeServerIndex: 0,
        trustInsecureCert: true,
      } as any,
      isLoaded: true,
    });
  });

  afterEach(() => {
    useSyncEngineStore.getState().stop();
  });

  it('passes every configured address to SyncEngine active server info', async () => {
    await useSyncEngineStore.getState().start();

    const engineOptions = getEngineOptions();
    expect(engineOptions.getActiveServer()).toEqual({
      baseUrl: 'https://clip.example.com',
      urls: ['https://clip.example.com', 'http://192.168.1.20:5033'],
      username: 'alice',
      password: 'secret',
      trustInsecureCert: true,
    });
  });

  it('attempts one direct upload when local clipboard changes and auto-push is enabled', async () => {
    const { notifyDeviceClipboardChanged } = require('@/stores/syncEngineStore');
    const { historyRepository } = require('@/services/db/historyRepository');

    await useSyncEngineStore.getState().start();
    getEngineInstance().pushRecordExplicit.mockImplementationOnce(async (profileHash: string) => {
      expect(await historyRepository.getByProfileHash(profileHash)).toEqual(
        expect.objectContaining({ profileHash: 'LOCAL_HASH', text: 'local' })
      );
    });
    await notifyDeviceClipboardChanged({
      type: 'Text',
      text: 'local',
      profileHash: 'LOCAL_HASH',
      localClipboardHash: 'LOCAL_HASH',
    });

    const engineInstance = getEngineInstance();
    expect(engineInstance.pushRecordExplicit).toHaveBeenCalledTimes(1);
    expect(engineInstance.pushRecordExplicit).toHaveBeenCalledWith('LOCAL_HASH');
    expect(engineInstance.notifyLocalChanged).not.toHaveBeenCalled();
  });

  it('keeps local clipboard content without uploading when auto-push is disabled', async () => {
    const { notifyDeviceClipboardChanged } = require('@/stores/syncEngineStore');
    useSettingsStore.setState((state) => ({
      config: { ...state.config, autoPushLocal: false } as any,
    }));

    await useSyncEngineStore.getState().start();
    await notifyDeviceClipboardChanged({
      type: 'Text',
      text: 'local only',
      profileHash: 'LOCAL_ONLY_HASH',
      localClipboardHash: 'LOCAL_ONLY_HASH',
    });

    expect(getEngineInstance().pushRecordExplicit).not.toHaveBeenCalled();
  });

  it('does not retry a failed automatic upload when the app becomes active again', async () => {
    const { notifyDeviceClipboardChanged } = require('@/stores/syncEngineStore');

    await useSyncEngineStore.getState().start();
    const engineInstance = getEngineInstance();
    engineInstance.pushRecordExplicit.mockRejectedValueOnce(new Error('offline'));

    await expect(
      notifyDeviceClipboardChanged({
        type: 'Text',
        text: 'keep local after failure',
        profileHash: 'FAILED_HASH',
        localClipboardHash: 'FAILED_HASH',
      })
    ).resolves.toBeUndefined();

    reconcileSyncEngineAppState('active');
    await Promise.resolve();

    expect(engineInstance.pushRecordExplicit).toHaveBeenCalledTimes(1);
  });

  it('does not let background upload override a disabled auto-push direction', async () => {
    (AppState as { currentState: string }).currentState = 'background';
    useSettingsStore.setState((state) => ({
      config: {
        ...state.config,
        autoPushLocal: false,
        enableBackgroundTasks: true,
        enableBackgroundUpload: true,
      } as any,
    }));

    await useSyncEngineStore.getState().start();

    const engineOptions = getEngineOptions();
    expect(engineOptions.getSettings().autoPushLocal).toBe(false);
  });

  it('allows background pushes only when direction and background capability are enabled', async () => {
    (AppState as { currentState: string }).currentState = 'background';
    useSettingsStore.setState((state) => ({
      config: {
        ...state.config,
        autoPushLocal: true,
        enableBackgroundTasks: true,
        enableBackgroundUpload: true,
      } as any,
    }));

    await useSyncEngineStore.getState().start();

    const engineOptions = getEngineOptions();
    expect(engineOptions.getSettings().autoPushLocal).toBe(true);
  });

  it('blocks background pushes when background upload capability is disabled', async () => {
    (AppState as { currentState: string }).currentState = 'background';
    useSettingsStore.setState((state) => ({
      config: {
        ...state.config,
        autoPushLocal: true,
        enableBackgroundTasks: true,
        enableBackgroundUpload: false,
      } as any,
    }));

    await useSyncEngineStore.getState().start();

    const engineOptions = getEngineOptions();
    expect(engineOptions.getSettings().autoPushLocal).toBe(false);
  });

  it('keeps remote sync running when auto-write and background download are enabled', async () => {
    useSettingsStore.setState((state) => ({
      config: {
        ...state.config,
        autoApplyRemote: true,
        enableBackgroundTasks: true,
        enableBackgroundDownload: true,
      } as any,
    }));
    await useSyncEngineStore.getState().start();
    const engineInstance = getEngineInstance();
    const appStateListener = getAppStateListener();

    (AppState as { currentState: string }).currentState = 'background';
    expect(appStateListener).toBeDefined();
    appStateListener?.('background');

    expect(engineInstance.stop).not.toHaveBeenCalled();
  });

  it('stops an already-backgrounded engine when background tasks are temporarily disabled', async () => {
    useSettingsStore.setState((state) => ({
      config: {
        ...state.config,
        autoApplyRemote: true,
        enableBackgroundTasks: true,
        enableBackgroundDownload: true,
      } as any,
      isTempDisabledBackgroundTasks: false,
    }));
    await useSyncEngineStore.getState().start();
    const engineInstance = getEngineInstance();
    const appStateListener = getAppStateListener();

    (AppState as { currentState: string }).currentState = 'background';
    appStateListener?.('background');
    engineInstance.stop.mockClear();

    useSettingsStore.setState({ isTempDisabledBackgroundTasks: true });
    reconcileSyncEngineAppState();

    expect(engineInstance.stop).toHaveBeenCalledTimes(1);
  });

  it('stops remote background sync when the auto-write direction is disabled', async () => {
    useSettingsStore.setState((state) => ({
      config: {
        ...state.config,
        autoApplyRemote: false,
        enableBackgroundTasks: true,
        enableBackgroundDownload: true,
      } as any,
    }));
    await useSyncEngineStore.getState().start();
    const engineInstance = getEngineInstance();
    const appStateListener = getAppStateListener();

    (AppState as { currentState: string }).currentState = 'background';
    expect(appStateListener).toBeDefined();
    appStateListener?.('background');

    expect(engineInstance.stop).toHaveBeenCalled();
  });

  // 回归:文本→文件连续应用后,系统剪贴板残留旧文本(File 写不进系统剪贴板)。
  // 回前台时 ClipboardMonitor 回读该残留文本,绝不能被登记为一次本地激活并 push 回去,
  // 否则会把服务端刚同步来的文件覆盖成旧文本(见 applyToDevice 的 wroteToClipboard 守卫)。
  it('applying a File does not let the stale prior text re-push over it', async () => {
    const { clipboardMonitor } = require('@/services/ClipboardMonitor');
    const { activateRepository } = require('@/services/db/activateRepository');
    const { writeActivate } = require('@/services/ActivateClipboardService');

    await useSyncEngineStore.getState().start();
    const engineOptions = getEngineOptions();

    // 1) 先应用一条文本 T —— 会真正写入系统剪贴板,故应登记为 monitor 的 echo 基准。
    await engineOptions.applyToDevice({
      kind: 'Text',
      text: 'stale text',
      hash: 'HASH_T',
      hasData: false,
      size: 9,
    });
    expect(clipboardMonitor.setLastContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileHash: 'HASH_T' })
    );

    (clipboardMonitor.setLastContent as jest.Mock).mockClear();

    // 2) 再应用一个文件 F —— 写不进 Android 系统剪贴板,不得谎报 echo 基准。
    await engineOptions.applyToDevice(
      { kind: 'File', text: 'a.zip', dataName: 'a.zip', hash: 'HASH_F', hasData: true, size: 100 },
      new ArrayBuffer(8)
    );
    expect(clipboardMonitor.setLastContent).not.toHaveBeenCalled();

    // 3) 模拟回前台:monitor 回读到系统剪贴板残留的旧文本 T → writeActivate(T)。
    //    anti-echo 基准仍是 HASH_T(文件应用没有覆盖它),故被判为 echo,寄存器不被写入。
    (activateRepository.upsert as jest.Mock).mockClear();
    await writeActivate({
      type: 'Text',
      text: 'stale text',
      profileHash: 'HASH_T',
      localClipboardHash: 'HASH_T',
    });
    expect(activateRepository.upsert).not.toHaveBeenCalled();
  });

  it('keeps an early clipboard change local without retaining it for a later retry', async () => {
    const { notifyDeviceClipboardChanged } = require('@/stores/syncEngineStore');
    const { historyRepository } = require('@/services/db/historyRepository');
    useSettingsStore.setState((state) => ({
      config: { ...state.config, autoPushLocal: false } as any,
    }));

    await notifyDeviceClipboardChanged({
      type: 'Text',
      text: 'local before engine',
      profileHash: 'EARLY_HASH',
      localClipboardHash: 'EARLY_HASH',
    });

    await useSyncEngineStore.getState().start();

    const engineOptions = getEngineOptions();
    expect(await historyRepository.getByProfileHash('EARLY_HASH')).toEqual(
      expect.objectContaining({
        profileHash: 'EARLY_HASH',
        text: 'local before engine',
      })
    );
    expect(await engineOptions.getDeviceClipboard()).toBeNull();
    expect(getEngineInstance().pushRecordExplicit).not.toHaveBeenCalled();
  });
});
