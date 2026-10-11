import { Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

const MODULE_NAME = 'ForegroundServiceModule';

export type ServiceStopReason =
  | 'user_stop'
  | 'user_pause'
  | 'task_removed'
  | 'system_timeout'
  | 'start_denied'
  | 'system_restart'
  | 'policy'
  | 'runtime_stop';

export interface ForegroundServiceStatus {
  running: boolean;
  /** Why the service last stopped; null while it runs or when it never stopped. */
  lastStopReason: ServiceStopReason | null;
  lastStopAt: number | null;
}

interface ForegroundServiceModuleType {
  startService(): boolean;
  stopService(runtimeStop?: boolean): boolean;
  updateNotification(content: string): boolean;
  isRunning(): boolean;
  getStatus(): ForegroundServiceStatus;
  addListener(eventName: string, listener: () => void): EventSubscription;
}

const NativeModule: ForegroundServiceModuleType | null =
  Platform.OS === 'android' ? requireNativeModule(MODULE_NAME) : null;

export function startService(): boolean {
  if (NativeModule) {
    return NativeModule.startService();
  }
  return false;
}

/**
 * Stops the service. `runtimeStop` marks a stop caused by the JS runtime ending rather than by the
 * user turning background sync off; it leaves the user's recovery intent intact.
 */
export function stopService(runtimeStop = false): boolean {
  if (NativeModule) {
    return NativeModule.stopService(runtimeStop);
  }
  return false;
}

export function updateNotification(content: string): boolean {
  if (NativeModule) {
    return NativeModule.updateNotification(content);
  }
  return false;
}

export function isRunning(): boolean {
  if (NativeModule) {
    return NativeModule.isRunning();
  }
  return false;
}

export function getStatus(): ForegroundServiceStatus {
  if (NativeModule) {
    return NativeModule.getStatus();
  }
  return { running: false, lastStopReason: null, lastStopAt: null };
}

export function addStopListener(listener: () => void): EventSubscription | null {
  if (NativeModule) {
    return NativeModule.addListener('onStopRequested', listener);
  }
  return null;
}

export function addTempStopListener(listener: () => void): EventSubscription | null {
  if (NativeModule) {
    return NativeModule.addListener('onTempStopRequested', listener);
  }
  return null;
}
