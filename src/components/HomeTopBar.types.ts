import type { useTheme } from '@/hooks/useTheme';
import type { DisplayKind } from '@/utils/displayKind';
import type { HistoryDateFilter } from '@/utils/historyFilters';
import type { ActionMenuItem } from '@/utils/actionMenuItems';

export interface DefaultTopBarProps {
  onSearch: () => void;
  onSettings: () => void;
  /** 显式进入多选(iOS「选择」按钮)。Android 由长按进入多选,不渲染此入口。 */
  onSelectMode: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

export interface SearchTopBarProps {
  searchText: string;
  onChangeText: (t: string) => void;
  selectedKinds: DisplayKind[];
  selectedDate: HistoryDateFilter;
  hasActiveFilters: boolean;
  resultCount?: number;
  isLoading?: boolean;
  onReset?: () => void;
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
  /**
   * 恰好选中一项时该项的内容类动作(Android 上下文操作栏的溢出菜单)。iOS 不使用。
   */
  itemActions?: ActionMenuItem[];
  theme: ReturnType<typeof useTheme>['theme'];
}
