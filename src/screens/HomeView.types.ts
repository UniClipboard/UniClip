import type { UpdateCheckResult } from '@/features/updates';

export interface HomeViewProps {
  onOpenSettings: () => void;
  onOpenAbout: (update: UpdateCheckResult) => void;
}
