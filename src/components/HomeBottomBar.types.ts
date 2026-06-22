import type { useTheme } from '@/hooks/useTheme';

export interface DefaultBottomBarProps {
  serverLabel: string;
  isSyncing: boolean;
  onSearch: () => void;
  onServerPicker: () => void;
  onSync: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

export interface SearchBottomBarProps {
  searchText: string;
  onChangeText: (t: string) => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

export interface SelectModeBottomBarProps {
  disabled: boolean;
  onCopy: () => void;
  onShare: () => void;
  onDelete: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}
