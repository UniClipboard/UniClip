import type { useTheme } from '@/hooks/useTheme';

export interface DefaultTopBarProps {
  serverLabel: string;
  isConnected: boolean;
  onSettings: () => void;
  onSelectMode: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

export interface SelectModeTopBarProps {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onDone: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}
