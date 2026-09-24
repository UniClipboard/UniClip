import type { UpdateCheckResult } from '@/features/updates';

export interface HomeViewProps {
  onOpenSettings: () => void;
  onOpenAbout: (update: UpdateCheckResult) => void;
  /** 首页进入 / 退出搜索或多选态(Android 据此隐藏底部导航栏)。 */
  onImmersiveModeChange?: (immersive: boolean) => void;
}
