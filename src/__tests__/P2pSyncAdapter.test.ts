import { describe, expect, it, jest } from '@jest/globals';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function loadP2pSyncAdapter():
  | (new (dependencies: unknown) => { start(context: unknown): Promise<void> })
  | undefined {
  try {
    return require('../features/sync/internal/p2pSyncAdapter').P2pSyncAdapter;
  } catch {
    return undefined;
  }
}

function dependencies(platform: 'android' | 'ios' = 'ios') {
  const delivery = {
    channel: 'p2p' as const,
    success: true,
    entryId: 'entry-1',
    profileHash: 'TEXT_HASH',
    deliveryState: 'delivered' as const,
    report: {
      entryId: 'entry-1',
      atMs: 1,
      totalAccepted: 1,
      totalDuplicate: 2,
      totalOffline: 3,
      totalErrored: 4,
      totalPending: 5,
    },
  };
  let engineEventListener: ((event: unknown) => void) | null = null;
  const engineEventUnsubscribe = jest.fn();
  const engine = {
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    setBackgroundSyncPolicy: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
    notifyConnectivityOpportunity: jest.fn(async (_reason: string) => undefined),
    recoverPeerConnections: jest.fn(async () => ({
      total: 1,
      online: 1,
      offline: 0,
      errors: 0,
    })),
    refreshPeerConnections: jest.fn(async () => ({
      total: 1,
      online: 1,
      offline: 0,
      errors: 0,
    })),
    cancelPeerRecovery: jest.fn(),
    subscribeEvents: jest.fn((listener: (event: unknown) => void) => {
      engineEventListener = listener;
      return engineEventUnsubscribe;
    }),
  };
  const space = {
    refresh: jest.fn(async () => ({ devices: [] })),
    refreshDevices: jest.fn(async () => ({ devices: [] })),
  };
  const content = {
    sendCurrentClipboard: jest.fn(async () => delivery),
    sendImportedText: jest.fn(async () => delivery),
    sendImportedAsset: jest.fn(async () => delivery),
  };
  const clipboard = {
    observeClipboardChange: jest.fn(async () => delivery.report),
    persistDelivery: jest.fn(async () => undefined),
  };
  return {
    platform,
    engine,
    space,
    content,
    clipboard,
    delivery,
    engineEventUnsubscribe,
    emitEngineEvent(event: unknown) {
      engineEventListener?.(event);
    },
  };
}

describe('P2pSyncAdapter', () => {
  it('reports foreground opportunity without running a product retry loop', async () => {
    const { P2pSyncAdapter } = require('../features/sync/internal/p2pSyncAdapter');
    const deps = dependencies('ios');
    const adapter = new P2pSyncAdapter(deps);
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: true },
    });
    expect(deps.engine.notifyConnectivityOpportunity).toHaveBeenCalledWith('foreground');
    expect(deps.engine.recoverPeerConnections).not.toHaveBeenCalled();
    expect(deps.engine.refreshPeerConnections).not.toHaveBeenCalled();
  });
  it('starts and refreshes the existing P2P runtime', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies('ios');
    const adapter = new P2pSyncAdapter(deps);

    await adapter.start({
      appVersion: '2.0.0+build.179',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: true },
    });

    expect(deps.engine.subscribeEvents.mock.invocationCallOrder[0]).toBeLessThan(
      deps.engine.start.mock.invocationCallOrder[0]
    );
    expect(deps.engine.start).toHaveBeenCalledWith({
      appVersion: '2.0.0+build.179',
      profileId: 'default',
    });
    expect(deps.engine.setBackgroundSyncPolicy).toHaveBeenCalledWith(true);
    expect(deps.engine.resume).toHaveBeenCalledTimes(1);
    expect(deps.space.refresh).toHaveBeenCalledTimes(1);
    expect(deps.engine.notifyConnectivityOpportunity).toHaveBeenCalledWith('foreground');
  });

  it('normalizes current clipboard delivery', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies();
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      sendCurrentClipboard(): Promise<unknown>;
    };

    await expect(adapter.sendCurrentClipboard()).resolves.toEqual({
      success: true,
      state: 'delivered',
      counts: { accepted: 1, duplicate: 2, offline: 3, errored: 4, pending: 5 },
    });
  });

  it('maps generic targets when sending imported text', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies();
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      sendImportedText(
        text: string,
        profileHash: string,
        options: { targetIds: string[] }
      ): Promise<unknown>;
    };

    await adapter.sendImportedText('shared text', 'TEXT_HASH', {
      targetIds: ['desktop-1'],
    });

    expect(deps.content.sendImportedText).toHaveBeenCalledWith('shared text', 'TEXT_HASH', {
      targetDeviceIds: ['desktop-1'],
    });
  });

  it('leaves automatic P2P target selection to the P2P implementation', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies();
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      sendImportedText(text: string, profileHash: string): Promise<unknown>;
    };

    await adapter.sendImportedText('automatic', 'TEXT_HASH');

    expect(deps.content.sendImportedText).toHaveBeenCalledWith('automatic', 'TEXT_HASH', undefined);
  });

  it('maps generic targets when sending imported assets', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies();
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      sendImportedAsset(
        asset: { kind: 'file'; uri: string; fileName: string },
        profileHash: string,
        options: { targetIds: string[] }
      ): Promise<unknown>;
    };
    const asset = {
      kind: 'file' as const,
      uri: 'file:///archive.zip',
      fileName: 'archive.zip',
    };

    await adapter.sendImportedAsset(asset, 'FILE_HASH', {
      targetIds: ['desktop-1'],
    });

    expect(deps.content.sendImportedAsset).toHaveBeenCalledWith(asset, 'FILE_HASH', {
      targetDeviceIds: ['desktop-1'],
    });
  });

  it('leaves background suspension to the native lifecycle', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies('ios');
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      handleAppStateChange(policy: { appState: 'inactive'; backgroundSyncEnabled: boolean }): void;
    };

    adapter.handleAppStateChange({
      appState: 'inactive',
      backgroundSyncEnabled: false,
    });

    expect(deps.engine.cancelPeerRecovery).not.toHaveBeenCalled();
  });

  it('refreshes P2P projections and publishes generic engine events', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies('android');
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      start(context: unknown): Promise<void>;
      subscribe(listener: (event: unknown) => void): () => void;
    };
    const received: unknown[] = [];
    adapter.subscribe((event) => received.push(event));
    await adapter.start({
      appVersion: '2.0.0+build.179',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: true },
    });

    deps.emitEngineEvent({
      type: 'peerPresenceChanged',
      deviceId: 'desktop-1',
    });
    deps.emitEngineEvent({ type: 'deviceTrustChanged', revision: 2 });
    deps.emitEngineEvent({ type: 'incomingEntry', entryId: 'entry-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.space.refreshDevices).toHaveBeenCalledTimes(1);
    expect(deps.space.refresh).toHaveBeenLastCalledWith({
      afterInvalidation: true,
    });
    expect(received).toEqual([
      { type: 'connectionChanged' },
      { type: 'configurationChanged' },
      { type: 'contentChanged' },
    ]);
  });

  it('stops recovery, events, and the P2P engine', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies();
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      start(context: unknown): Promise<void>;
      stop(): Promise<void>;
    };
    await adapter.start({
      appVersion: '2.0.0+build.179',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: true },
    });

    await adapter.stop();

    expect(deps.engine.cancelPeerRecovery).not.toHaveBeenCalled();
    expect(deps.engineEventUnsubscribe).toHaveBeenCalledTimes(1);
    expect(deps.engine.stop).toHaveBeenCalledTimes(1);
  });

  it('routes device events received while P2P startup is still in progress', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies('ios');
    const started = deferred<void>();
    deps.engine.start.mockImplementationOnce(() => started.promise);
    const adapter = new P2pSyncAdapter(deps);

    const start = adapter.start({
      appVersion: '2.0.0+build.179',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: true },
    });
    await Promise.resolve();
    deps.emitEngineEvent({
      type: 'peerPresenceChanged',
      deviceId: 'desktop-1',
    });
    started.resolve();
    await start;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.space.refreshDevices).toHaveBeenCalledTimes(1);
  });

  it('does not refresh P2P projections for events while the app is in background', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies('ios');
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      start(context: unknown): Promise<void>;
      handleAppStateChange(policy: unknown): void;
    };
    await adapter.start({
      appVersion: '2.0.0+build.179',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: true },
    });
    deps.space.refresh.mockClear();
    deps.space.refreshDevices.mockClear();
    adapter.handleAppStateChange({
      appState: 'background',
      backgroundSyncEnabled: false,
    });

    deps.emitEngineEvent({
      type: 'peerPresenceChanged',
      deviceId: 'desktop-1',
    });
    deps.emitEngineEvent({ type: 'deviceTrustChanged', revision: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.space.refreshDevices).not.toHaveBeenCalled();
    expect(deps.space.refresh).not.toHaveBeenCalled();
  });

  it('does not cancel peer recovery for Android app-state changes', () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies('android');
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      handleAppStateChange(policy: unknown): void;
    };

    adapter.handleAppStateChange({
      appState: 'background',
      backgroundSyncEnabled: false,
    });

    expect(deps.engine.cancelPeerRecovery).not.toHaveBeenCalled();
  });

  it('observes automatic clipboard changes and persists P2P delivery', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies();
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      observeClipboardChange(content: unknown, dispatch: boolean): Promise<unknown>;
    };
    const content = {
      type: 'Text',
      text: 'captured',
      profileHash: 'TEXT_HASH',
    };

    await expect(adapter.observeClipboardChange(content, true)).resolves.toEqual({
      success: true,
      state: 'partial',
      counts: { accepted: 1, duplicate: 2, offline: 3, errored: 4, pending: 5 },
    });
    expect(deps.clipboard.observeClipboardChange).toHaveBeenCalledWith(true);
    expect(deps.clipboard.persistDelivery).toHaveBeenCalledWith('TEXT_HASH', deps.delivery.report);
  });

  it('uses the existing P2P connection refresh for manual synchronization', async () => {
    const P2pSyncAdapter = loadP2pSyncAdapter();
    expect(P2pSyncAdapter).toBeDefined();
    if (!P2pSyncAdapter) return;

    const deps = dependencies();
    const adapter = new P2pSyncAdapter(deps) as unknown as {
      synchronize(): Promise<void>;
    };

    await adapter.synchronize();

    expect(deps.engine.refreshPeerConnections).toHaveBeenCalledTimes(1);
  });
});
