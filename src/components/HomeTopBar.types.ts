import type { useTheme } from '@/hooks/useTheme';

export interface DefaultTopBarProps {
  serverLabel: string;
  isConnected: boolean;
  onSearch: () => void;
  onSettings: () => void;
  onSelectMode: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

export interface SearchTopBarProps {
  searchText: string;
  onChangeText: (t: string) => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

export interface SelectModeTopBarProps {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onDone: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}
