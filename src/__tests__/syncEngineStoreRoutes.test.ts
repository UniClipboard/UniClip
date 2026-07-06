import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncEngineStore } from '@/stores/syncEngineStore';
import { SyncEngine } from '@/services/SyncEngine';

jest.mock('@/services/SyncEngine', () => ({
  SyncEngine: jest.fn().mockImplementation((options) => ({
    options,
    init: jest.fn().mockResolvedValue(undefined),
    start: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(),
    addListener: jest.fn(),
    getStatus: jest.fn(),
    notifyLocalChanged: jest.fn(),
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
    getClipboardContent: jest.fn().mockResolvedValue(null),
    setImageContent: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/services/ClipboardMonitor', () => ({
  clipboardMonitor: {
    addCallback: jest.fn(),
    removeCallback: jest.fn(),
    pausePolling: jest.fn(),
    resumePolling: jest.fn(),
    setLastContent: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/utils/clipboardProxy', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
  getStringAsync: jest.fn().mockResolvedValue(''),
}));

jest.mock('@/utils/fileStorage', () => ({
  saveHistoryFile: jest.fn().mockResolvedValue('file:///history/a.zip'),
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

    const engineOptions = (SyncEngine as jest.Mock).mock.calls[0][0];
    expect(engineOptions.getActiveServer()).toEqual({
      baseUrl: 'https://clip.example.com',
      urls: ['https://clip.example.com', 'http://192.168.1.20:5033'],
      username: 'alice',
      password: 'secret',
      trustInsecureCert: true,
    });
  });

  it('kicks SyncEngine immediately when local clipboard changes', async () => {
    const { notifyDeviceClipboardChanged } = require('@/stores/syncEngineStore');

    await useSyncEngineStore.getState().start();
    await notifyDeviceClipboardChanged({
      type: 'Text',
      text: 'local',
      profileHash: 'LOCAL_HASH',
      localClipboardHash: 'LOCAL_HASH',
    });

    const engineInstance = (SyncEngine as jest.Mock).mock.results[0].value;
    expect(engineInstance.notifyLocalChanged).toHaveBeenCalled();
  });

  // 回归:文本→文件连续应用后,系统剪贴板残留旧文本(File 写不进系统剪贴板)。
  // 回前台时 ClipboardMonitor 回读该残留文本,绝不能被登记为一次本地激活并 push 回去,
  // 否则会把服务端刚同步来的文件覆盖成旧文本(见 applyToDevice 的 wroteToClipboard 守卫)。
  it('applying a File does not let the stale prior text re-push over it', async () => {
    const { clipboardMonitor } = require('@/services/ClipboardMonitor');
    const { activateRepository } = require('@/services/db/activateRepository');
    const { writeActivate } = require('@/services/ActivateClipboardService');

    await useSyncEngineStore.getState().start();
    const engineOptions = (SyncEngine as jest.Mock).mock.calls[0][0];

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

  it('keeps a clipboard change that arrives before SyncEngine starts', async () => {
    const { notifyDeviceClipboardChanged } = require('@/stores/syncEngineStore');

    await notifyDeviceClipboardChanged({
      type: 'Text',
      text: 'local before engine',
      profileHash: 'EARLY_HASH',
      localClipboardHash: 'EARLY_HASH',
    });

    await useSyncEngineStore.getState().start();

    const engineOptions = (SyncEngine as jest.Mock).mock.calls[0][0];
    expect(await engineOptions.getDeviceClipboard()).toEqual(
      expect.objectContaining({
        hash: 'EARLY_HASH',
        meta: expect.objectContaining({
          hash: 'EARLY_HASH',
          text: 'local before engine',
        }),
      })
    );
  });
});
