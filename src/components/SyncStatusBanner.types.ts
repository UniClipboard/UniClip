import type { useTheme } from '@/hooks/useTheme';

/** staged = HasNewUnwritten(引擎已产出 stagedEntry,待用户应用);loop = LoopDetected(需用户确认解除)。 */
export type SyncStatusBannerVariant = 'staged' | 'loop';

export interface SyncStatusBannerProps {
  variant: SyncStatusBannerVariant;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
  isActionBusy?: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
}
