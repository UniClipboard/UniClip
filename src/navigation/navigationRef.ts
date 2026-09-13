import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './AppNavigator.types';

/**
 * 全局 navigation ref
 *
 * 用法：在 NavigationContainer 的 ref prop 上挂载，从 App 顶层（NavigationContainer 之外）
 * 通过此 ref 触发跳转，例如深链路由。
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

type NavigationRequest = {
  [Route in keyof RootStackParamList]: undefined extends RootStackParamList[Route]
    ? [name: Route, params?: RootStackParamList[Route]]
    : [name: Route, params: RootStackParamList[Route]];
}[keyof RootStackParamList];

let pendingNavigation: NavigationRequest | null = null;

/**
 * 导航到目标路由。若 NavigationContainer 尚未就绪（冷启动深链在导航栈挂载前触发），
 * 则暂存为 pending，待 NavigationContainer onReady 调用 flushPendingNavigation() 时补执行。
 * 取代旧的 navigateIfReady——后者在未就绪时直接静默丢弃且无重试，导致冷启动深链落空。
 */
export function navigateWhenReady(...target: NavigationRequest): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate(...target);
  } else {
    pendingNavigation = target;
  }
}

/** NavigationContainer onReady 时调用，补执行冷启动期间暂存的深链导航。 */
export function flushPendingNavigation(): void {
  if (!pendingNavigation || !navigationRef.isReady()) return;
  const target = pendingNavigation;
  pendingNavigation = null;
  navigationRef.navigate(...target);
}
