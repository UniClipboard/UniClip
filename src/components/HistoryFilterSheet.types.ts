import type { useTheme } from '@/hooks/useTheme';
import type { DisplayKind } from '@/utils/displayKind';
import type { HistoryDateFilter } from '@/utils/historyFilters';

export interface HistoryFilterSheetProps {
  visible: boolean;
  selectedKinds: DisplayKind[];
  selectedDate: HistoryDateFilter;
  onToggleKind: (kind: DisplayKind) => void;
  onSelectDate: (dateFilter: HistoryDateFilter) => void;
  onClear: () => void;
  onClose: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}
