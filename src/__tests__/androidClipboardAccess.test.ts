import {
  changeBackgroundClipboardMethod,
  getAlternativeClipboardMethod,
  getBackgroundClipboardSetupState,
  getClipboardAdapter,
  getShizukuAuthorizationState,
  refreshBackgroundClipboardAuthorization,
  selectBackgroundClipboardAdapter,
  type BackgroundClipboardAdapter,
} from '@/utils/backgroundClipboardAccess';

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

  it('keeps method switching inside the shared clipboard abstraction', () => {
    expect(getAlternativeClipboardMethod('overlay')).toBe('shizuku');
    expect(getAlternativeClipboardMethod('shizuku')).toBe('overlay');
  });

  it('reports an OEM clipboard restriction instead of ready', () => {
    expect(
      getShizukuAuthorizationState({ available: true, authorized: true, restricted: true })
    ).toEqual({ status: 'incompatible', monitoringStatus: 'setup-required' });
  });

  it('returns the requested adapter for authorization even before it is ready', () => {
    const overlay = adapter('overlay', true);
    const shizuku = adapter('shizuku', false);

    expect(getClipboardAdapter('shizuku', { overlay, shizuku })).toBe(shizuku);
  });

  it('returns the selected ready adapter in the background', () => {
    const overlay = adapter('overlay', true);
    const shizuku = adapter('shizuku', true);

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'shizuku',
        appIsBackground: true,
        operation: 'read',
        adapters: { overlay, shizuku },
      })
    ).toBe(shizuku);
  });

  it('does not fall back to another adapter when the selected one is unavailable', () => {
    const overlay = adapter('overlay', true);
    const shizuku = adapter('shizuku', false);

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'shizuku',
        appIsBackground: true,
        operation: 'read',
        adapters: { overlay, shizuku },
      })
    ).toBeNull();
  });

  it('does not use a background adapter while the app is in front', () => {
    const overlay = adapter('overlay', true);
    const shizuku = adapter('shizuku', true);

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'overlay',
        appIsBackground: false,
        operation: 'read',
        adapters: { overlay, shizuku },
      })
    ).toBeNull();
  });

  it('allows the selected monitor adapter to register while the app is in front', () => {
    const overlay = adapter('overlay', true);
    const shizuku = adapter('shizuku', true);

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'shizuku',
        appIsBackground: false,
        operation: 'monitor',
        adapters: { overlay, shizuku },
      })
    ).toBe(shizuku);
  });

  it('checks readiness for the requested operation', () => {
    const overlay = adapter('overlay', (operation) => operation === 'write');
    const shizuku = adapter('shizuku', true);

    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'overlay',
        appIsBackground: true,
        operation: 'read',
        adapters: { overlay, shizuku },
      })
    ).toBeNull();
    expect(
      selectBackgroundClipboardAdapter({
        selectedMethod: 'overlay',
        appIsBackground: true,
        operation: 'write',
        adapters: { overlay, shizuku },
      })
    ).toBe(overlay);
  });

  it('changes methods through the same adapter lifecycle', async () => {
    const overlay = adapter('overlay', true);
    const shizuku = adapter('shizuku', true);
    overlay.deactivate = jest.fn().mockResolvedValue(undefined);
    shizuku.activate = jest.fn().mockResolvedValue(undefined);
    const persist = jest.fn().mockResolvedValue(undefined);
    const restart = jest.fn().mockResolvedValue(undefined);

    await changeBackgroundClipboardMethod({
      currentMethod: 'overlay',
      nextMethod: 'shizuku',
      adapters: { overlay, shizuku },
      persist,
      restart,
    });

    expect(overlay.deactivate).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('shizuku');
    expect(shizuku.activate).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(overlay.deactivate.mock.invocationCallOrder[0]).toBeLessThan(
      persist.mock.invocationCallOrder[0]
    );
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
      shizuku.activate.mock.invocationCallOrder[0]
    );
    expect(shizuku.activate.mock.invocationCallOrder[0]).toBeLessThan(
      restart.mock.invocationCallOrder[0]
    );
  });

  it('continues the newly selected method setup after switching', async () => {
    const overlay = adapter('overlay', true);
    const shizuku = adapter('shizuku', false);
    shizuku.continueSetup = jest.fn().mockResolvedValue('waiting-for-return');

    const result = await changeBackgroundClipboardMethod({
      currentMethod: 'overlay',
      nextMethod: 'shizuku',
      adapters: { overlay, shizuku },
      persist: jest.fn().mockResolvedValue(undefined),
      restart: jest.fn().mockResolvedValue(undefined),
    });

    expect(result).toBe('waiting-for-return');
    expect(shizuku.continueSetup).toHaveBeenCalledTimes(1);
  });

  it('keeps the new method selected when its follow-up setup throws', async () => {
    const overlay = adapter('overlay', true);
    const shizuku = adapter('shizuku', false);
    overlay.activate = jest.fn().mockResolvedValue(undefined);
    shizuku.continueSetup = jest.fn().mockRejectedValue(new Error('setup failed'));

    await expect(
      changeBackgroundClipboardMethod({
        currentMethod: 'overlay',
        nextMethod: 'shizuku',
        adapters: { overlay, shizuku },
        persist: jest.fn().mockResolvedValue(undefined),
        restart: jest.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow('setup failed');

    expect(overlay.activate).not.toHaveBeenCalled();
  });

  it('publishes new authorization state before restarting monitoring', async () => {
    const shizuku = adapter('shizuku', true);
    const state = shizuku.getAuthorizationState();
    const publish = jest.fn();
    const restart = jest.fn().mockResolvedValue(undefined);

    await refreshBackgroundClipboardAuthorization(shizuku, publish, restart);

    expect(publish).toHaveBeenCalledWith(state);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(restart.mock.invocationCallOrder[0]);
  });
});
