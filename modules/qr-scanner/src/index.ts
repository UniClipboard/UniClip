import { requireNativeModule, Platform } from 'expo-modules-core';

const NativeModule = Platform.OS === 'ios' ? requireNativeModule('QrScanner') : null;

export async function scanQRCode(): Promise<string | null> {
  if (!NativeModule) return null;
  return NativeModule.scanQRCode();
}
