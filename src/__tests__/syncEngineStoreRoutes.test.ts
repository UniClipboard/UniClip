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
    notifyDeviceChanged: jest.fn(),
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
    notifyDeviceClipboardChanged({
      type: 'Text',
      text: 'local',
      profileHash: 'LOCAL_HASH',
      localClipboardHash: 'LOCAL_HASH',
    });

    const engineInstance = (SyncEngine as jest.Mock).mock.results[0].value;
    expect(engineInstance.notifyDeviceChanged).toHaveBeenCalledWith('LOCAL_HASH');
  });

  it('keeps a clipboard change that arrives before SyncEngine starts', async () => {
    const { notifyDeviceClipboardChanged } = require('@/stores/syncEngineStore');

    notifyDeviceClipboardChanged({
      type: 'Text',
      text: 'local before engine',
      profileHash: 'EARLY_HASH',
      localClipboardHash: 'EARLY_HASH',
    });

    await useSyncEngineStore.getState().start();

    const engineOptions = (SyncEngine as jest.Mock).mock.calls[0][0];
    expect(engineOptions.getDeviceClipboard()).toEqual(
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
