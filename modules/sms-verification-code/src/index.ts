import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/**
 * Outcome of recognizing a one-time code in an SMS body. `ambiguous` means several
 * distinct codes tied, so no code is offered.
 */
export type SmsCodeRecognition =
  | { status: 'match'; code: string }
  | { status: 'ambiguous' }
  | { status: 'none' };

interface SmsVerificationCodeModuleType {
  recognize(body: string): SmsCodeRecognition;
  isAutoCopyEnabled(): boolean;
  setAutoCopyEnabled(enabled: boolean): boolean;
  markCodeCopied(code: string): void;
}

export const isSmsVerificationCodeAvailable = Platform.OS === 'android';

let nativeModule: SmsVerificationCodeModuleType | null = null;

function getNativeModule(): SmsVerificationCodeModuleType {
  if (Platform.OS !== 'android') {
    throw new Error('SmsVerificationCode is only available on Android');
  }
  nativeModule ??= requireNativeModule<SmsVerificationCodeModuleType>(
    'SmsVerificationCode'
  );
  return nativeModule;
}

/** Runs the same native recognizer the SMS receive path uses. Pure: no side effects. */
export function recognizeSmsVerificationCode(body: string): SmsCodeRecognition {
  return getNativeModule().recognize(body);
}

/** True only when the user turned it on and RECEIVE_SMS is still granted. */
export function isSmsCodeAutoCopyEnabled(): boolean {
  return isSmsVerificationCodeAvailable && getNativeModule().isAutoCopyEnabled();
}

/**
 * Turns the SMS receiver on or off. Returns false, and leaves it off, when enabling
 * without the RECEIVE_SMS permission (request it first).
 */
export function setSmsCodeAutoCopyEnabled(enabled: boolean): boolean {
  return getNativeModule().setAutoCopyEnabled(enabled);
}

/** Updates the code notification to say "copied"; call only after a verified clipboard write. */
export function markSmsCodeCopied(code: string): void {
  getNativeModule().markCodeCopied(code);
}
