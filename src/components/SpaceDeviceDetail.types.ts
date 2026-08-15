import type { DeviceTrustDeviceView } from '@/features/space';

export interface SpaceDeviceDetailProps {
  device: DeviceTrustDeviceView | null;
  canRemove: boolean;
  confirmingRemoval: boolean;
  removing: boolean;
  removeErrorMessage: string | null;
  onClose: () => void;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
  onUpdateThisDevice?: () => void;
}
