import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { isTailscaleActive } from 'android-util';

export interface NetworkContext {
  isWifi: boolean;
  isCellular: boolean;
  isTailscale: boolean;
  ssid?: string | null;
}

let currentNetworkContext: NetworkContext = {
  isWifi: false,
  isCellular: false,
  isTailscale: false,
};
let unsubscribeNetworkContextMonitor: (() => void) | null = null;
let onNetworkContextChanged: (() => void) | null = null;

export function configureNetworkContextChangeListener(listener: () => void): void {
  onNetworkContextChanged = listener;
}

export function getCurrentNetworkContext(): NetworkContext {
  return { ...currentNetworkContext };
}

export function setCurrentNetworkContext(next: Partial<NetworkContext>): void {
  currentNetworkContext = {
    ...currentNetworkContext,
    ...next,
  };
}

export function startNetworkContextMonitor(): () => void {
  if (unsubscribeNetworkContextMonitor) return unsubscribeNetworkContextMonitor;

  unsubscribeNetworkContextMonitor = NetInfo.addEventListener((state) => {
    const changed = applyNetInfoState(state);
    if (changed) {
      notifyRouteNetworkChanged();
    }
  });

  return unsubscribeNetworkContextMonitor;
}

export function stopNetworkContextMonitor(): void {
  unsubscribeNetworkContextMonitor?.();
  unsubscribeNetworkContextMonitor = null;
}

export function applyNetInfoState(state: NetInfoState): boolean {
  const next = networkContextFromNetInfo(state);
  const previous = currentNetworkContext;
  currentNetworkContext = next;
  return !networkContextEquals(previous, next);
}

function networkContextFromNetInfo(state: NetInfoState): NetworkContext {
  const details = state.details as { ssid?: string | null } | null | undefined;
  const isWifi = state.type === 'wifi' && state.isConnected !== false;
  const isCellular = state.type === 'cellular' && state.isConnected !== false;
  return {
    isWifi,
    isCellular,
    isTailscale: isTailscaleActive(),
    ssid: isWifi ? details?.ssid ?? null : null,
  };
}

function networkContextEquals(a: NetworkContext, b: NetworkContext): boolean {
  return (
    a.isWifi === b.isWifi &&
    a.isCellular === b.isCellular &&
    a.isTailscale === b.isTailscale &&
    (a.ssid ?? null) === (b.ssid ?? null)
  );
}

function notifyRouteNetworkChanged(): void {
  onNetworkContextChanged?.();
}
