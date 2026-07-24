import type { useTheme } from '@/hooks/useTheme';
import type { ServerConfig } from '@/types/api';
import type { SyncChannel, SyncConnectionTarget } from '@/types/settings';

export interface ServerSwitcherModalProps {
  visible: boolean;
  servers: ServerConfig[];
  activeIndex: number;
  selectedChannel: SyncChannel;
  p2pSpaceId: string | null;
  legacyLanEligible: boolean;
  onSelect: (target: SyncConnectionTarget) => void;
  onClose: () => void;
  onAdd: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}
