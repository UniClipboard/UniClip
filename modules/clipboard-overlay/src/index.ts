import { Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

const MODULE_NAME = 'ClipboardOverlayModule';

interface ClipboardOverlayImage {
  data: string;
  size: { width: number; height: number };
}

/** Payload emitted by the ClipCascade-style clipboard monitor. */
export interface ClipboardChangeEvent {
  type: 'text' | 'image' | 'files';
  /** Text content, or a content:// URI string for image/files. */
  content: string;
}

interface ClipboardOverlayModuleInterface {
  setDebugMode(enabled: boolean): boolean;
  setMaxRetries(retries: number): boolean;
  hasOverlayPermission(): boolean;
  requestOverlayPermission(): void;
  isOverlayShowing(): boolean;
  showOverlayWindow(): Promise<boolean>;
  hideOverlayWindow(): Promise<boolean>;
  getStringViaOverlay(): Promise<string>;
  setStringViaOverlay(text: string): Promise<boolean>;
  hasStringViaOverlay(): Promise<boolean>;
  hasImageViaOverlay(): Promise<boolean>;
  getImageViaOverlay(): Promise<ClipboardOverlayImage | null>;
  saveImageToFileViaOverlay(
    destDirPath: string
  ): Promise<{ width: number; height: number; filePath: string; mimeType: string } | null>;
  // Event-driven monitor (ClipCascade-style trigger layer)
  hasReadLogsPermission(): boolean;
  isClipboardMonitoring(): boolean;
  startClipboardMonitor(): Promise<boolean>;
  stopClipboardMonitor(): Promise<boolean>;
  addListener(
    eventName: 'onClipboardChange',
    listener: (event: ClipboardChangeEvent) => void
  ): EventSubscription;
}

const NativeModule: ClipboardOverlayModuleInterface | null =
  Platform.OS === 'android' ? requireNativeModule(MODULE_NAME) : null;

export function setDebugMode(enabled: boolean): void {
  if (NativeModule) {
    NativeModule.setDebugMode(enabled);
  }
}

export function setMaxRetries(retries: number): void {
  if (NativeModule) {
    NativeModule.setMaxRetries(retries);
  }
}

export function hasOverlayPermission(): boolean {
  if (NativeModule) {
    return NativeModule.hasOverlayPermission();
  }
  return false;
}

export function requestOverlayPermission(): void {
  if (NativeModule) {
    NativeModule.requestOverlayPermission();
  }
}

export function isOverlayShowing(): boolean {
  if (NativeModule) {
    return NativeModule.isOverlayShowing();
  }
  return false;
}

export async function showOverlayWindow(): Promise<boolean> {
  if (NativeModule) {
    return NativeModule.showOverlayWindow();
  }
  return false;
}

export async function hideOverlayWindow(): Promise<boolean> {
  if (NativeModule) {
    return NativeModule.hideOverlayWindow();
  }
  return false;
}

export async function getStringViaOverlay(): Promise<string> {
  if (NativeModule) {
    return NativeModule.getStringViaOverlay();
  }
  return '';
}

export async function setStringViaOverlay(text: string): Promise<boolean> {
  if (NativeModule) {
    return NativeModule.setStringViaOverlay(text);
  }
  return false;
}

export async function hasStringViaOverlay(): Promise<boolean> {
  if (NativeModule) {
    return NativeModule.hasStringViaOverlay();
  }
  return false;
}

export async function hasImageViaOverlay(): Promise<boolean> {
  if (NativeModule) {
    return NativeModule.hasImageViaOverlay();
  }
  return false;
}

export async function getImageViaOverlay(): Promise<ClipboardOverlayImage | null> {
  if (NativeModule) {
    return NativeModule.getImageViaOverlay();
  }
  return null;
}

export async function saveImageToFileViaOverlay(
  destDirPath: string
): Promise<{ width: number; height: number; filePath: string; mimeType: string } | null> {
  if (NativeModule) {
    return NativeModule.saveImageToFileViaOverlay(destDirPath);
  }
  return null;
}

/**
 * Whether READ_LOGS is granted. Only grantable via adb:
 *   adb shell pm grant <pkg> android.permission.READ_LOGS
 * Without it the monitor only observes foreground clipboard changes.
 */
export function hasReadLogsPermission(): boolean {
  if (NativeModule) {
    return NativeModule.hasReadLogsPermission();
  }
  return false;
}

export function isClipboardMonitoring(): boolean {
  if (NativeModule) {
    return NativeModule.isClipboardMonitoring();
  }
  return false;
}

/**
 * Start the event-driven clipboard monitor (ClipCascade-style).
 * Emits `onClipboardChange` on both foreground copies and background copies
 * (the latter only when READ_LOGS is granted). Replaces polling-based reads.
 */
export async function startClipboardMonitor(): Promise<boolean> {
  if (NativeModule) {
    return NativeModule.startClipboardMonitor();
  }
  return false;
}

export async function stopClipboardMonitor(): Promise<boolean> {
  if (NativeModule) {
    return NativeModule.stopClipboardMonitor();
  }
  return false;
}

/**
 * Subscribe to clipboard changes. Returns a subscription; call `.remove()` to
 * unsubscribe. No-op (returns null) on non-Android platforms.
 */
export function addClipboardChangeListener(
  listener: (event: ClipboardChangeEvent) => void
): EventSubscription | null {
  if (NativeModule) {
    return NativeModule.addListener('onClipboardChange', listener);
  }
  return null;
}
