import NetInfo from '@react-native-community/netinfo';
import {
  applyNetInfoState,
  getCurrentNetworkContext,
  startNetworkContextMonitor,
  stopNetworkContextMonitor,
} from '@/services/networkContext';
import { notifyNetworkChanged } from '@/stores/syncEngineStore';
import { isTailscaleActive } from 'native-util';

jest.mock('@/stores/syncEngineStore', () => ({
  notifyNetworkChanged: jest.fn(),
}));

describe('networkContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('notifies the sync engine when the subscribed network state changes', () => {
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

    expect(notifyNetworkChanged).toHaveBeenCalledTimes(1);
  });
});
