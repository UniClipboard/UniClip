import type { useTheme } from '@/hooks/useTheme';
import type { ActionMenuItem } from '@/utils/actionMenuItems';
import type { HistoryLayout } from '@/hooks/useHistoryDisplaySettings';

export interface DefaultTopBarProps {
  onSearch: () => void;
  onSettings: () => void;
  /** 显式进入多选(iOS「选择」按钮)。Android 由长按进入多选,不渲染此入口。 */
  onSelectMode: () => void;
  /**
   * 首页历史的显示方式与切换回调(Android 搜索栏尾部 ⋮「显示方式」菜单)。
   * 不传则不显示该菜单;iOS 暂不使用。
   */
  historyLayout?: HistoryLayout;
  onHistoryLayoutChange?: (layout: HistoryLayout) => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

export interface SearchTopBarProps {
  searchText: string;
  onChangeText: (t: string) => void;
  hasActiveFilters: boolean;
  resultCount?: number;
  isLoading?: boolean;
  onReset?: () => void;
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
