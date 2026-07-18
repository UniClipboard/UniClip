import { describe, expect, it, jest } from '@jest/globals';
import {
  changeBackgroundClipboardMethod,
  getBackgroundClipboardSetupState,
  getClipboardAdapter,
  getShizukuAuthorizationState,
  refreshBackgroundClipboardAuthorization,
  selectBackgroundClipboardAdapter,
  type BackgroundClipboardAdapter,
} from '../utils/backgroundClipboardAccess';

const adapter = (
  method: BackgroundClipboardAdapter['method'],
  ready: boolean | ((operation: 'monitor' | 'read' | 'write') => boolean)
): BackgroundClipboardAdapter => ({
  method,
  isReady: (operation) => (typeof ready === 'function' ? ready(operation) : ready),
  startMonitoring: async () => null,
  runTriggeredRead: async (read) => read(),
  getString: async () => method,
  setString: async () => true,
  hasString: async () => true,
  hasImage: async () => false,
  saveImageToFile: async () => null,
  activate: async () => {},
  deactivate: async () => {},
  addAuthorizationChangeListener: () => ({ remove: () => {} }),
  getAuthorizationState: () => ({
    status: ready ? 'ready' : 'unauthorized',
    monitoringStatus: ready ? 'ready' : 'setup-required',
  }),
  requestAuthorization: () => true,
  continueSetup: async () => 'no-action',
});

const adapterRegistry = ({
  pollingReady = true,
  eventReady = true,
  shizukuReady = true,
}: {
  pollingReady?: boolean | ((operation: 'monitor' | 'read' | 'write') => boolean);
  eventReady?: boolean | ((operation: 'monitor' | 'read' | 'write') => boolean);
  shizukuReady?: boolean | ((operation: 'monitor' | 'read' | 'write') => boolean);
} = {}) => ({
  'overlay-polling': adapter('overlay-polling', pollingReady),
  'overlay-event': adapter('overlay-event', eventReady),
  shizuku: adapter('shizuku', shizukuReady),
});

describe('selectBackgroundClipboardAdapter', () => {
  it.each([
    {
      state: { status: 'unavailable', monitoringStatus: 'setup-required' } as const,
      expected: { status: 'action-required', issue: 'service-unavailable' },
    },
    {
      state: { status: 'unauthorized', monitoringStatus: 'setup-required' } as const,
      expected: { status: 'action-required', issue: 'permission-required' },
    },
    {
      state: { status: 'incompatible', monitoringStatus: 'setup-required' } as const,
      expected: { status: 'action-required', issue: 'system-restriction' },
    },
    {
      state: { status: 'ready', monitoringStatus: 'setup-required' } as const,
      expected: { status: 'action-required', issue: 'monitoring-setup-required' },
    },
    {
      state: { status: 'ready', monitoringStatus: 'ready' } as const,
      expected: { status: 'ready', issue: null },
    },
  ])('collapses authorization into one user-facing setup state', ({ state, expected }) => {
    expect(getBackgroundClipboardSetupState(state)).toEqual(expected);
  });

  it('reports an OEM clipboard restriction instead of ready', () => {
    expect(
      getShizukuAuthorizationState({ available: true, authorized: true, restricted: true })
    ).toEqual({ status: 'incompatible', monitoringStatus: 'setup-required' });
  });

  it('returns the requested adapter for authorization even before it is ready', () => {
    const adapters = adapterRegistry({ shizukuReady: false });

    expect(getClipboardAdapter('shizuku', adapters)).toBe(adapters.shizuku);
  });

  it('returns the selected ready adapter in the background', () => {
    const adapters = adapterRegistry();

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'shizuku',
        appIsBackground: true,
        operation: 'read',
        adapters,
      })
    ).toBe(adapters.shizuku);
  });

  it('does not fall back to another adapter when the selected one is unavailable', () => {
    const adapters = adapterRegistry({ shizukuReady: false });

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'shizuku',
        appIsBackground: true,
        operation: 'read',
        adapters,
      })
    ).toBeNull();
  });

  it('does not use a background adapter while the app is in front', () => {
    const adapters = adapterRegistry();

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'overlay-polling',
        appIsBackground: false,
        operation: 'read',
        adapters,
      })
    ).toBeNull();
  });

  it('allows the selected monitor adapter to register while the app is in front', () => {
    const adapters = adapterRegistry();

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'shizuku',
        appIsBackground: false,
        operation: 'monitor',
        adapters,
      })
    ).toBe(adapters.shizuku);
  });

  it('checks readiness for the requested operation', () => {
    const adapters = adapterRegistry({
      eventReady: (operation) => operation === 'write',
    });

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'overlay-event',
        appIsBackground: true,
        operation: 'read',
        adapters,
      })
    ).toBeNull();
    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'overlay-event',
        appIsBackground: true,
        operation: 'write',
        adapters,
      })
    ).toBe(adapters['overlay-event']);
  });

  it('changes methods through the same adapter lifecycle', async () => {
    const adapters = adapterRegistry();
    const current = adapters['overlay-polling'];
    const next = adapters.shizuku;
    const deactivate = jest.fn<BackgroundClipboardAdapter['deactivate']>(async () => {});
    const activate = jest.fn<BackgroundClipboardAdapter['activate']>(async () => {});
    current.deactivate = deactivate;
    next.activate = activate;
    const persist = jest.fn<(method: BackgroundClipboardAdapter['method']) => Promise<void>>(
      async () => {}
    );
    const restart = jest.fn<() => Promise<void>>(async () => {});

    await changeBackgroundClipboardMethod({
      currentMethod: 'overlay-polling',
      nextMethod: 'shizuku',
      adapters,
      persist,
      restart,
    });

    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('shizuku');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(deactivate.mock.invocationCallOrder[0]).toBeLessThan(
      persist.mock.invocationCallOrder[0]
    );
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(activate.mock.invocationCallOrder[0]);
    expect(activate.mock.invocationCallOrder[0]).toBeLessThan(restart.mock.invocationCallOrder[0]);
  });

  it('restores the previous method when activating the new adapter fails', async () => {
    const adapters = adapterRegistry();
    const current = adapters['overlay-polling'];
    const next = adapters.shizuku;
    current.activate = jest.fn<BackgroundClipboardAdapter['activate']>(async () => {});
    next.activate = jest.fn<BackgroundClipboardAdapter['activate']>(async () => {
      throw new Error('activate failed');
    });
    next.deactivate = jest.fn<BackgroundClipboardAdapter['deactivate']>(async () => {});
    const persist = jest.fn<(method: BackgroundClipboardAdapter['method']) => Promise<void>>(
      async () => {}
    );
    const restart = jest.fn<() => Promise<void>>(async () => {});

    await expect(
      changeBackgroundClipboardMethod({
        currentMethod: 'overlay-polling',
        nextMethod: 'shizuku',
        adapters,
        persist,
        restart,
      })
    ).rejects.toThrow('activate failed');

    expect(next.deactivate).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenNthCalledWith(1, 'shizuku');
    expect(persist).toHaveBeenNthCalledWith(2, 'overlay-polling');
    expect(current.activate).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('restores and restarts the previous method when the new monitor fails to restart', async () => {
    const adapters = adapterRegistry();
    const current = adapters['overlay-event'];
    const next = adapters.shizuku;
    current.activate = jest.fn<BackgroundClipboardAdapter['activate']>(async () => {});
    next.deactivate = jest.fn<BackgroundClipboardAdapter['deactivate']>(async () => {});
    const persist = jest.fn<(method: BackgroundClipboardAdapter['method']) => Promise<void>>(
      async () => {}
    );
    const restart = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('restart failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      changeBackgroundClipboardMethod({
        currentMethod: 'overlay-event',
        nextMethod: 'shizuku',
        adapters,
        persist,
        restart,
      })
    ).rejects.toThrow('restart failed');

    expect(next.deactivate).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenNthCalledWith(1, 'shizuku');
    expect(persist).toHaveBeenNthCalledWith(2, 'overlay-event');
    expect(current.activate).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(2);
  });

  it('continues the newly selected method setup after switching', async () => {
    const adapters = adapterRegistry({ shizukuReady: false });
    const continueSetup = jest.fn<BackgroundClipboardAdapter['continueSetup']>(
      async () => 'waiting-for-return'
    );
    adapters.shizuku.continueSetup = continueSetup;

    const result = await changeBackgroundClipboardMethod({
      currentMethod: 'overlay-polling',
      nextMethod: 'shizuku',
      adapters,
      persist: async () => {},
      restart: async () => {},
    });

    expect(result).toBe('waiting-for-return');
    expect(continueSetup).toHaveBeenCalledTimes(1);
  });

  it('keeps the new method selected when its follow-up setup throws', async () => {
    const adapters = adapterRegistry({ shizukuReady: false });
    const activate = jest.fn<BackgroundClipboardAdapter['activate']>(async () => {});
    adapters['overlay-polling'].activate = activate;
    adapters.shizuku.continueSetup = jest.fn<BackgroundClipboardAdapter['continueSetup']>(
      async () => {
        throw new Error('setup failed');
      }
    );

    await expect(
      changeBackgroundClipboardMethod({
        currentMethod: 'overlay-polling',
        nextMethod: 'shizuku',
        adapters,
        persist: async () => {},
        restart: async () => {},
      })
    ).rejects.toThrow('setup failed');

    expect(activate).not.toHaveBeenCalled();
  });

  it('publishes new authorization state before restarting monitoring', async () => {
    const shizuku = adapter('shizuku', true);
    const state = shizuku.getAuthorizationState();
    const publish =
      jest.fn<
        (nextState: ReturnType<BackgroundClipboardAdapter['getAuthorizationState']>) => void
      >();
    const restart = jest.fn<() => Promise<void>>(async () => {});

    await refreshBackgroundClipboardAuthorization(shizuku, publish, restart);

    expect(publish).toHaveBeenCalledWith(state);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(restart.mock.invocationCallOrder[0]);
  });
});
