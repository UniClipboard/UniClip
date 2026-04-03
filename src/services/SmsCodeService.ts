/**
 * SMS Verification Code Service
 * 短信验证码服务 - 监听短信，提取验证码并上传到服务器
 */

import { Platform } from 'react-native';
import type { EventSubscription } from 'expo-modules-core';
import { SyncManager } from './SyncManager';
import { calculateTextHash } from '@/utils/hash';
import type { ClipboardContent } from '@/types/clipboard';

// 验证码正则表达式
const VERIFICATION_CODE_REGEX =
  /(.*)((代|授权|验证|动态|校验)码|[【\[].*[】\]]|[Cc][Oo][Dd][Ee]|[Vv]erification\s?([Cc]ode)?)\s?(G-|<#>)?([:：\s是为]|[Ii][Ss]){0,3}[\(（\[【{「]?(([0-9\s]{4,6})|([A-Za-z\d]{5,6})(?!([Vv]erification)?([Cc][Oo][Dd][Ee])|:))[」}】\]）\)]?(?=([^0-9a-zA-Z]|$))(.*)/;

class SmsCodeService {
  private static instance: SmsCodeService | null = null;
  private subscription: EventSubscription | null = null;
  private enabled = false;

  private constructor() {}

  static getInstance(): SmsCodeService {
    if (!SmsCodeService.instance) {
      SmsCodeService.instance = new SmsCodeService();
    }
    return SmsCodeService.instance;
  }

  async enable(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (this.enabled) return;

    const { startListening, addSmsListener } = await import('sms-forwarder');

    startListening();
    this.subscription = addSmsListener((event) => {
      this.handleSmsReceived(event.from, event.body);
    });
    this.enabled = true;
    console.log('[SmsCodeService] Enabled - listening for SMS');
  }

  disable(): void {
    if (!this.enabled) return;

    this.subscription?.remove();
    this.subscription = null;

    import('sms-forwarder').then(({ stopListening }) => {
      stopListening();
    });

    this.enabled = false;
    console.log('[SmsCodeService] Disabled');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 从短信中提取验证码
   */
  extractVerificationCode(body: string): string | null {
    const match = body.match(VERIFICATION_CODE_REGEX);
    if (match && match[7]) {
      return match[7].replace(/\s/g, '');
    }
    return null;
  }

  private async handleSmsReceived(from: string, body: string): Promise<void> {
    console.log(`[SmsCodeService] SMS received from ${from}`);

    const code = this.extractVerificationCode(body);
    if (!code) {
      console.log('[SmsCodeService] No verification code found in SMS');
      return;
    }

    console.log(`[SmsCodeService] Verification code extracted: ${code}`);

    try {
      const profileHash = await calculateTextHash(code);

      const content: ClipboardContent = {
        type: 'Text',
        text: code,
        profileHash,
        localClipboardHash: profileHash,
        timestamp: Date.now(),
      };

      const syncManager = SyncManager.getInstance();
      const apiClient = syncManager.getAPIClient();
      if (!apiClient) {
        console.warn('[SmsCodeService] No API client available, cannot upload verification code');
        return;
      }

      await apiClient.putContent(content);
      console.log(`[SmsCodeService] Verification code uploaded: ${code}`);
    } catch (error) {
      console.error('[SmsCodeService] Failed to upload verification code:', error);
    }
  }
}

export function getSmsCodeService(): SmsCodeService {
  return SmsCodeService.getInstance();
}
