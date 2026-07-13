import { AppState, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Clipboard from 'expo-clipboard';
import { setTimer, clearTimer } from 'native-timer';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  changeBackgroundClipboardMethod,
  getShizukuAuthorizationState,
  selectBackgroundClipboardAdapter,
  getClipboardAdapter,
  type BackgroundClipboardAdapter,
  type BackgroundClipboardEvent,
  type BackgroundClipboardMonitor,
  type BackgroundClipboardOperation,
  type BackgroundClipboardSetupActionResult,
} from '@/utils/backgroundClipboardAccess';

const OVERLAY_IDLE_TIMEOUT_MS = 10_000;
const OVERLAY_IDLE_TIMER = 'clipboard_overlay_idle';

function getOverlayModule(): typeof import('clipboard-overlay') {
  return require('clipboard-overlay');
}

function getShizukuModule(): typeof import('shizuku-clipboard') {
  return require('shizuku-clipboard');
}

class OverlayClipboardAdapter implements BackgroundClipboardAdapter {
  readonly method = 'overlay' as const;
  private triggeredRead = false;

  isReady(operation: BackgroundClipboardOperation): boolean {
    const overlayModule = getOverlayModule();
    const config = useSettingsStore.getState().config;
    if (!(config?.enableClipboardOverlay ?? false) || !overlayModule.hasOverlayPermission()) {
      return false;
    }
    if (operation === 'monitor') return overlayModule.hasReadLogsPermission();
    if (operation === 'read') return this.triggeredRead;
    return true;
  }

  async startMonitoring(
    listener: (event: BackgroundClipboardEvent) => void
  ): Promise<BackgroundClipboardMonitor | null> {
    const overlayModule = getOverlayModule();
    const eventSubscription = overlayModule.addClipboardChangeListener(listener);
    const started = await overlayModule.startClipboardMonitor();
    if (!started) {
      eventSubscription?.remove();
      return null;
    }
    return {
      remove: () => {
        eventSubscription?.remove();
        void overlayModule.stopClipboardMonitor();
      },
    };
  }

  async runTriggeredRead<T>(read: () => Promise<T>): Promise<T> {
    this.triggeredRead = true;
    try {
      return await read();
    } finally {
      this.triggeredRead = false;
    }
  }

  async getString(): Promise<string> {
    await this.prepareOverlay();
    return getOverlayModule().getStringViaOverlay();
  }

  async setString(text: string): Promise<boolean> {
    await this.prepareOverlay();
    return getOverlayModule().setStringViaOverlay(text);
  }

  async hasString(): Promise<boolean> {
    await this.prepareOverlay();
    return getOverlayModule().hasStringViaOverlay();
  }

  async hasImage(): Promise<boolean> {
    await this.prepareOverlay();
    return getOverlayModule().hasImageViaOverlay();
  }

  async saveImageToFile(
    destDirPath: string
  ): Promise<{ filePath: string; mimeType: string } | null> {
    await this.prepareOverlay();
    const result = await getOverlayModule().saveImageToFileViaOverlay(destDirPath);
    return result ? { filePath: result.filePath, mimeType: result.mimeType } : null;
  }

  async activate(): Promise<void> {
    await useSettingsStore.getState().setEnableClipboardOverlay(true);
  }

  async deactivate(): Promise<void> {
    await useSettingsStore.getState().setEnableClipboardOverlay(false);
    this.dismiss();
  }

  addAuthorizationChangeListener(listener: () => void): BackgroundClipboardMonitor {
    let previousState = JSON.stringify(this.getAuthorizationState());
    return AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const nextState = JSON.stringify(this.getAuthorizationState());
      if (nextState === previousState) return;
      previousState = nextState;
      listener();
    });
  }

  getAuthorizationState() {
    const overlayModule = getOverlayModule();
    const monitoringReady = overlayModule.hasReadLogsPermission();
    const applicationId = Application.applicationId ?? 'app.uniclipboard.android';
    return {
      status: overlayModule.hasOverlayPermission() ? ('ready' as const) : ('unauthorized' as const),
      monitoringStatus: monitoringReady ? ('ready' as const) : ('setup-required' as const),
      setupCommand: monitoringReady
        ? undefined
        : `adb shell pm grant ${applicationId} android.permission.READ_LOGS`,
    };
  }

  requestAuthorization(): boolean {
    getOverlayModule().requestOverlayPermission();
    return true;
  }

  async continueSetup(): Promise<BackgroundClipboardSetupActionResult> {
    const state = this.getAuthorizationState();
    if (state.status === 'unauthorized') {
      return this.requestAuthorization() ? 'waiting-for-return' : 'failed';
    }
    if (state.setupCommand) {
      await Clipboard.setStringAsync(state.setupCommand);
      return 'command-copied';
    }
    return 'no-action';
  }

  dismiss(): void {
    clearTimer(OVERLAY_IDLE_TIMER);
    const overlayModule = getOverlayModule();
    if (overlayModule.isOverlayShowing()) void overlayModule.hideOverlayWindow();
  }

  private async prepareOverlay(): Promise<void> {
    const overlayModule = getOverlayModule();
    const config = useSettingsStore.getState().config;
    const showOverlay = (config?.debugMode ?? false) && (config?.debugOverlayVisible ?? false);
    overlayModule.setDebugMode(showOverlay);
    overlayModule.setMaxRetries(config?.debugMode ? 20 : 5);
    if (!overlayModule.isOverlayShowing()) await overlayModule.showOverlayWindow();
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    clearTimer(OVERLAY_IDLE_TIMER);
    setTimer(() => this.dismiss(), OVERLAY_IDLE_TIMEOUT_MS, OVERLAY_IDLE_TIMER);
  }
}

class ShizukuClipboardAdapter implements BackgroundClipboardAdapter {
  readonly method = 'shizuku' as const;

  isReady(_operation: BackgroundClipboardOperation): boolean {
    return this.getAuthorizationState().status === 'ready';
  }

  async startMonitoring(
    listener: (event: BackgroundClipboardEvent) => void
  ): Promise<BackgroundClipboardMonitor | null> {
    const shizukuModule = getShizukuModule();
    const eventSubscription = shizukuModule.addClipboardChangeListener(listener);
    const started = await shizukuModule.startClipboardMonitor();
    if (!started) {
      eventSubscription?.remove();
      return null;
    }
    return {
      remove: () => {
        eventSubscription?.remove();
        void shizukuModule.stopClipboardMonitor();
      },
    };
  }

  runTriggeredRead<T>(read: () => Promise<T>): Promise<T> {
    return read();
  }

  getString(): Promise<string> {
    return getShizukuModule().getStringViaShizuku();
  }

  setString(text: string): Promise<boolean> {
    return getShizukuModule().setStringViaShizuku(text);
  }

  hasString(): Promise<boolean> {
    return getShizukuModule().hasStringViaShizuku();
  }

  hasImage(): Promise<boolean> {
    return getShizukuModule().hasImageViaShizuku();
  }

  saveImageToFile(destDirPath: string): Promise<{ filePath: string; mimeType: string } | null> {
    return getShizukuModule().saveImageToFileViaShizuku(destDirPath);
  }

  async activate(): Promise<void> {}

  async deactivate(): Promise<void> {}

  addAuthorizationChangeListener(listener: () => void): BackgroundClipboardMonitor {
    return getShizukuModule().addShizukuStateListener(listener) ?? { remove: () => {} };
  }

  getAuthorizationState() {
    const shizukuModule = getShizukuModule();
    return getShizukuAuthorizationState({
      available: shizukuModule.isShizukuAvailable(),
      authorized: shizukuModule.hasShizukuPermission(),
      restricted: shizukuModule.isBackgroundClipboardRestricted(),
    });
  }

  requestAuthorization(): boolean {
    if (this.getAuthorizationState().status === 'incompatible') return false;
    return getShizukuModule().requestShizukuPermission();
  }

  async continueSetup(): Promise<BackgroundClipboardSetupActionResult> {
    const state = this.getAuthorizationState();
    if (state.status === 'incompatible') {
      return (await getShizukuModule().resolveBackgroundClipboardRestriction())
        ? 'completed'
        : 'failed';
    }
    if (state.status === 'unavailable' && state.setupUrl) {
      await Linking.openURL(state.setupUrl);
      return 'waiting-for-return';
    }
    if (state.status === 'unauthorized') {
      return this.requestAuthorization() ? 'waiting-for-return' : 'failed';
    }
    return 'no-action';
  }
}

const overlayAdapter = new OverlayClipboardAdapter();
const adapters = {
  overlay: overlayAdapter,
  shizuku: new ShizukuClipboardAdapter(),
};

AppState.addEventListener('change', (state) => {
  if (Platform.OS === 'android' && state === 'active') overlayAdapter.dismiss();
});

export function getBackgroundClipboardAdapter(
  operation: BackgroundClipboardOperation
): BackgroundClipboardAdapter | null {
  const config = useSettingsStore.getState().config;
  return selectBackgroundClipboardAdapter({
    selectedMethod: config?.clipboardAccessMethod ?? 'overlay',
    appIsBackground: AppState.currentState === 'background',
    operation,
    adapters,
  });
}

export function getClipboardAccessAdapter(
  method: 'overlay' | 'shizuku'
): BackgroundClipboardAdapter {
  return getClipboardAdapter(method, adapters);
}

export function changeClipboardAccessMethod(
  currentMethod: 'overlay' | 'shizuku',
  nextMethod: 'overlay' | 'shizuku',
  persist: (method: 'overlay' | 'shizuku') => Promise<void>,
  restart: () => Promise<void>
): Promise<BackgroundClipboardSetupActionResult> {
  return changeBackgroundClipboardMethod({
    currentMethod,
    nextMethod,
    adapters,
    persist,
    restart,
  });
}
