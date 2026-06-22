import type { useTheme } from '@/hooks/useTheme';
import type { ServerConfig } from '@/types/api';

export interface ServerSwitcherModalProps {
  visible: boolean;
  servers: ServerConfig[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  onAdd: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}
