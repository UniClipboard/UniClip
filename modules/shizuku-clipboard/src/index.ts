import { Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export interface ShizukuClipboardEvent {
  type: 'text' | 'image' | 'files';
  content: string;
  mimeType?: string;
  displayName?: string;
}

export interface ShizukuStateEvent {
  state: string;
}

interface ShizukuClipboardModuleInterface {
  isShizukuAvailable(): boolean;
  hasShizukuPermission(): boolean;
  isBackgroundClipboardRestricted(): boolean;
  resolveBackgroundClipboardRestriction(): Promise<boolean>;
  requestShizukuPermission(): boolean;
  startClipboardMonitor(): Promise<boolean>;
  stopClipboardMonitor(): Promise<boolean>;
  getStringViaShizuku(): Promise<string>;
  hasStringViaShizuku(): Promise<boolean>;
  hasImageViaShizuku(): Promise<boolean>;
  saveImageToFileViaShizuku(
    destDirPath: string
  ): Promise<{ filePath: string; mimeType: string } | null>;
  setStringViaShizuku(text: string): Promise<boolean>;
  addListener(
    eventName: 'onClipboardChange',
    listener: (event: ShizukuClipboardEvent) => void
  ): EventSubscription;
  addListener(
    eventName: 'onShizukuStateChange',
    listener: (event: ShizukuStateEvent) => void
  ): EventSubscription;
}

const NativeModule: ShizukuClipboardModuleInterface | null =
  Platform.OS === 'android' ? requireNativeModule('ShizukuClipboardModule') : null;

export function isShizukuAvailable(): boolean {
  return NativeModule?.isShizukuAvailable() ?? false;
}

export function hasShizukuPermission(): boolean {
  return NativeModule?.hasShizukuPermission() ?? false;
}

export function isBackgroundClipboardRestricted(): boolean {
  return NativeModule?.isBackgroundClipboardRestricted() ?? false;
}

export function requestShizukuPermission(): boolean {
  return NativeModule?.requestShizukuPermission() ?? false;
}

export async function resolveBackgroundClipboardRestriction(): Promise<boolean> {
  return NativeModule?.resolveBackgroundClipboardRestriction() ?? false;
}

export async function startClipboardMonitor(): Promise<boolean> {
  return NativeModule?.startClipboardMonitor() ?? false;
}

export async function stopClipboardMonitor(): Promise<boolean> {
  return NativeModule?.stopClipboardMonitor() ?? false;
}

export async function getStringViaShizuku(): Promise<string> {
  return NativeModule?.getStringViaShizuku() ?? '';
}

export async function hasStringViaShizuku(): Promise<boolean> {
  return NativeModule?.hasStringViaShizuku() ?? false;
}

export async function hasImageViaShizuku(): Promise<boolean> {
  return NativeModule?.hasImageViaShizuku() ?? false;
}

export async function saveImageToFileViaShizuku(
  destDirPath: string
): Promise<{ filePath: string; mimeType: string } | null> {
  return NativeModule?.saveImageToFileViaShizuku(destDirPath) ?? null;
}

export async function setStringViaShizuku(text: string): Promise<boolean> {
  return NativeModule?.setStringViaShizuku(text) ?? false;
}

export function addClipboardChangeListener(
  listener: (event: ShizukuClipboardEvent) => void
): EventSubscription | null {
  return NativeModule?.addListener('onClipboardChange', listener) ?? null;
}

export function addShizukuStateListener(
  listener: (event: ShizukuStateEvent) => void
): EventSubscription | null {
  return NativeModule?.addListener('onShizukuStateChange', listener) ?? null;
}
