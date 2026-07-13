describe('clipboardStore initial clipboard read', () => {
  let addItem: jest.Mock;
  let getClipboardContent: jest.Mock;
  let checkAndUpdateLastContent: jest.Mock;
  let startMonitor: jest.Mock;
  let stopMonitor: jest.Mock;
  let addCallback: jest.Mock;
  let notifyDeviceClipboardChanged: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    addItem = jest.fn().mockImplementation(async (item) => item);
    getClipboardContent = jest.fn().mockResolvedValue({
      type: 'Text',
      text: 'hello from paste permission',
      fileSize: 27,
      profileHash: 'LOCAL_HASH',
      localClipboardHash: 'LOCAL_HASH',
      hasData: false,
      timestamp: 12345,
    });
    checkAndUpdateLastContent = jest.fn().mockResolvedValue(true);
    startMonitor = jest.fn().mockResolvedValue(undefined);
    stopMonitor = jest.fn();
    addCallback = jest.fn();
    notifyDeviceClipboardChanged = jest.fn();

    jest.doMock('../services', () => ({
      clipboardManager: {
        getClipboardContent,
      },
      clipboardMonitor: {
        addCallback,
        removeCallback: jest.fn(),
        start: startMonitor,
        stop: stopMonitor,
        updatePollingInterval: jest.fn(),
        checkAndUpdateLastContent,
        setLastContent: jest.fn(),
        isReadBlockedByDenial: jest.fn(() => false),
      },
    }));

    jest.doMock('../stores/historyStore', () => ({
      useHistoryStore: {
        getState: () => ({
          addItem,
        }),
      },
    }));

    jest.doMock('../stores/syncEngineStore', () => ({
      notifyDeviceClipboardChanged,
    }));
  });

  afterEach(() => {
    jest.dontMock('../services');
    jest.dontMock('../stores/historyStore');
    jest.dontMock('../stores/syncEngineStore');
  });

  it('stores the current clipboard content immediately when monitoring starts', async () => {
    const { useClipboardStore } = require('../stores/clipboardStore');

    await useClipboardStore.getState().startMonitoring();

    expect(startMonitor).toHaveBeenCalledTimes(1);
    expect(getClipboardContent).toHaveBeenCalledTimes(1);
    expect(checkAndUpdateLastContent).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hello from paste permission',
        profileHash: 'LOCAL_HASH',
      })
    );
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'Text',
        text: 'hello from paste permission',
        profileHash: 'LOCAL_HASH',
        localClipboardHash: 'LOCAL_HASH',
      })
    );
    expect(notifyDeviceClipboardChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'hello from paste permission',
        profileHash: 'LOCAL_HASH',
      })
    );
  });

  it('force restarts monitoring without registering the store callback twice', async () => {
    const { useClipboardStore } = require('../stores/clipboardStore');

    await useClipboardStore.getState().startMonitoring();
    await useClipboardStore.getState().restartMonitoring();

    expect(stopMonitor).toHaveBeenCalledTimes(1);
    expect(startMonitor).toHaveBeenCalledTimes(2);
    expect(addCallback).toHaveBeenCalledTimes(1);
    expect(useClipboardStore.getState().isMonitoring).toBe(true);
  });

  it('coalesces concurrent monitoring restart requests', async () => {
    const { useClipboardStore } = require('../stores/clipboardStore');

    await useClipboardStore.getState().startMonitoring();
    await Promise.all([
      useClipboardStore.getState().restartMonitoring(),
      useClipboardStore.getState().restartMonitoring(),
    ]);

    expect(stopMonitor).toHaveBeenCalledTimes(1);
    expect(startMonitor).toHaveBeenCalledTimes(2);
  });
});
