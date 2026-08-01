import type { useTheme } from '@/hooks/useTheme';

export interface SelectModeBottomBarProps {
  disabled: boolean;
  onCopy: () => void;
  onShare: () => void;
  onDelete: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
}
