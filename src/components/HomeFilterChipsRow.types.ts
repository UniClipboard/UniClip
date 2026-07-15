import type { useTheme } from '@/hooks/useTheme';
import type { DisplayKind } from '@/utils/displayKind';
import type { HistoryDateFilter } from '@/utils/historyFilters';

export interface HomeFilterChipsRowProps {
  selectedKinds: DisplayKind[];
  selectedDate: HistoryDateFilter;
  onToggleKind: (kind: DisplayKind) => void;
  /** 「全部」chip:只清类型选择,不动时间筛选 */
  onClearKinds: () => void;
  onSelectDate: (dateFilter: HistoryDateFilter) => void;
  theme: ReturnType<typeof useTheme>['theme'];
}

export const FILTER_CHIP_ROW_HEIGHT = 46;
