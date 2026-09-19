import NetInfo from '@react-native-community/netinfo';
import {
  applyNetInfoState,
  configureNetworkContextChangeListener,
  getCurrentNetworkContext,
  startNetworkContextMonitor,
  stopNetworkContextMonitor,
} from '@/platform/network';
import { isTailscaleActive } from 'android-util';

const mockWarn = jest.fn();
jest.mock('@/support/observability', () => ({
  createLogger: () => ({ warn: (...args: unknown[]) => mockWarn(...args) }),
}));

const mockBackgroundServiceRefresh = jest.fn<() => Promise<void>>(async () => undefined);

describe('networkContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureNetworkContextChangeListener(() => {
      return mockBackgroundServiceRefresh();
    });
    (isTailscaleActive as jest.Mock).mockReturnValue(false);
    stopNetworkContextMonitor();
    applyNetInfoState({
      type: 'unknown',
      isConnected: false,
      isInternetReachable: false,
      details: null,
    } as any);
  });

  afterEach(() => {
    stopNetworkContextMonitor();
  });

  it('handles startup failure from a network refresh and allows the next change', async () => {
    let listener: ((state: any) => void) | undefined;
    (NetInfo.addEventListener as jest.Mock).mockImplementation((nextListener) => {
      listener = nextListener;
      return jest.fn();
    });
    mockBackgroundServiceRefresh.mockRejectedValueOnce(new Error('engine unavailable'));
    startNetworkContextMonitor();
    listener?.({ type: 'wifi', isConnected: true, details: { ssid: 'test' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockWarn).toHaveBeenCalledWith('Failed to refresh services after a network change');
    listener?.({ type: 'cellular', isConnected: true, details: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockBackgroundServiceRefresh).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('maps wifi netinfo state into route network context', () => {
    const changed = applyNetInfoState({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: { ssid: 'Office WiFi' },
    } as any);

    expect(changed).toBe(true);
    expect(getCurrentNetworkContext()).toEqual({
      isWifi: true,
      isCellular: false,
      isTailscale: false,
      ssid: 'Office WiFi',
    });
  });

  it('maps cellular state and drops stale wifi ssid', () => {
    applyNetInfoState({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: { ssid: 'Office WiFi' },
    } as any);

    const changed = applyNetInfoState({
      type: 'cellular',
      isConnected: true,
      isInternetReachable: true,
      details: { cellularGeneration: '5g' },
    } as any);

    expect(changed).toBe(true);
    expect(getCurrentNetworkContext()).toEqual({
      isWifi: false,
      isCellular: true,
      isTailscale: false,
      ssid: null,
    });
  });

  it('uses native Tailscale detection when routing on cellular', () => {
    (isTailscaleActive as jest.Mock).mockReturnValue(true);

    const changed = applyNetInfoState({
      type: 'cellular',
      isConnected: true,
      isInternetReachable: true,
      details: { cellularGeneration: '5g' },
    } as any);

    expect(changed).toBe(true);
    expect(getCurrentNetworkContext()).toEqual({
      isWifi: false,
      isCellular: true,
      isTailscale: true,
      ssid: null,
    });
  });

  it('reports unchanged state so callers can avoid route refreshes', () => {
    const state = {
      type: 'cellular',
      isConnected: true,
      isInternetReachable: true,
      details: {},
    } as any;

    expect(applyNetInfoState(state)).toBe(true);
    expect(applyNetInfoState(state)).toBe(false);
  });

  it('refreshes background policy when the subscribed network state changes', () => {
    let listener: ((state: any) => void) | undefined;
    (NetInfo.addEventListener as jest.Mock).mockImplementation((nextListener) => {
      listener = nextListener;
      return jest.fn();
    });

    startNetworkContextMonitor();
    listener?.({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: { ssid: 'Office WiFi' },
    });

    expect(mockBackgroundServiceRefresh).toHaveBeenCalledTimes(1);
  });
});
