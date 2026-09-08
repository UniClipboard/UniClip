import { create } from 'zustand';
import type { LanConnectIntent } from './connectUri';

interface PendingLanConnectState {
  intent: LanConnectIntent | null;
  set(intent: LanConnectIntent): void;
  consume(): LanConnectIntent | null;
  clear(): void;
}

export const usePendingLanConnectStore = create<PendingLanConnectState>((set, get) => ({
  intent: null,
  set: (intent) => set({ intent }),
  consume: () => {
    const intent = get().intent;
    if (intent) set({ intent: null });
    return intent;
  },
  clear: () => set({ intent: null }),
}));

interface LanQrScannerState {
  isVisible: boolean;
  onScanned: ((intent: LanConnectIntent) => void) | null;
  onCancelled: (() => void) | null;
  open(onScanned: (intent: LanConnectIntent) => void, onCancelled?: () => void): void;
  complete(intent: LanConnectIntent): void;
  close(): void;
}

export const useLanQrScannerStore = create<LanQrScannerState>((set, get) => ({
  isVisible: false,
  onScanned: null,
  onCancelled: null,
  open: (onScanned, onCancelled) => {
    get().close();
    set({ isVisible: true, onScanned, onCancelled: onCancelled ?? null });
  },
  complete: (intent) => {
    const callback = get().onScanned;
    set({ isVisible: false, onScanned: null, onCancelled: null });
    callback?.(intent);
  },
  close: () => {
    const cancel = get().onCancelled;
    set({ isVisible: false, onScanned: null, onCancelled: null });
    cancel?.();
  },
}));
