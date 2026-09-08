import type { LanConnectIntent } from './connectUri';
import { useLanQrScannerStore } from './handoff';

export function scanLanConnection(
  _cancelLabel: string,
  _hint: string
): Promise<LanConnectIntent | null> {
  return new Promise((resolve) =>
    useLanQrScannerStore.getState().open(resolve, () => resolve(null))
  );
}
