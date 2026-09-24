import type { SharedValue } from 'react-native-reanimated';
import type { UpdateCheckResult } from '@/features/updates';

export interface HomeViewProps {
  onOpenSettings: () => void;
  onOpenAbout: (update: UpdateCheckResult) => void;
  /** 首页进入 / 退出搜索或多选态(Android 据此隐藏底部导航栏)。 */
  onImmersiveModeChange?: (immersive: boolean) => void;
  /** Android:添加菜单展开态的即时信号,悬浮导航胶囊据此让位于菜单遮罩。 */
  addMenuOpenSignal?: SharedValue<boolean>;
}
