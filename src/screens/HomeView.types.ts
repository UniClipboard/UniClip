import type { UpdateCheckResult } from '@/services/UpdateService';

export interface HomeViewProps {
  onOpenSettings: () => void;
  onOpenAbout: (update: UpdateCheckResult) => void;
}
