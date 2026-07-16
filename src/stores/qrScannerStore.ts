import { create } from 'zustand';

interface QrScannerState {
  isVisible: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Keeps the Android scanner in the application-level Modal host. Scanning
 * must not be rendered as a child of the server form's native Modal.
 */
export const useQrScannerStore = create<QrScannerState>((set) => ({
  isVisible: false,
  open: () => set({ isVisible: true }),
  close: () => set({ isVisible: false }),
}));
