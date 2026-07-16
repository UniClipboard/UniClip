import { QrScannerModal } from './QrScannerModal';
import { useQrScannerStore } from '@/stores/qrScannerStore';

/** Renders the scanner outside every screen-level native Modal. */
export function QrScannerHost() {
  const visible = useQrScannerStore((s) => s.isVisible);
  const close = useQrScannerStore((s) => s.close);

  return <QrScannerModal visible={visible} onClose={close} />;
}
