import type { useTheme } from '@/hooks/useTheme';
import type { DisplayKind } from '@/utils/displayKind';
import type { HistoryDateFilter } from '@/utils/historyFilters';

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
  selectedKinds: DisplayKind[];
  selectedDate: HistoryDateFilter;
  hasActiveFilters: boolean;
  onOpenFilters: () => void;
  onRemoveKind: (kind: DisplayKind) => void;
  onClearDateFilter: () => void;
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
