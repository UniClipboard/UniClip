/**
 * SMS Verification Code Service
 * 短信验证码服务 - 监听短信，提取验证码并上传到服务器
 */

import { Platform, ToastAndroid } from 'react-native';
import type { EventSubscription } from 'expo-modules-core';
import * as Clipboard from 'expo-clipboard';
import { SyncManager } from './SyncManager';
import { SyncDirection } from '@/types/sync';
import { calculateTextHash } from '@/utils/hash';
import { useSettingsStore } from '@/stores';
import type { ClipboardContent } from '@/types/clipboard';

// 验证码正则表达式
const VERIFICATION_CODE_REGEX =
  /(.*)((代|授权|验证|动态|校验)码|[【\[].*[】\]]|[Cc][Oo][Dd][Ee]|[Vv]erification\s?([Cc]ode)?)\s?(G-|<#>)?([:：\s是为]|[Ii][Ss]){0,3}[\(（\[【{「]?(([0-9\s]{4,6})|([A-Za-z\d]{5,6})(?!([Vv]erification)?([Cc][Oo][Dd][Ee])|:))[」}】\]）\)]?(?=([^0-9a-zA-Z]|$))(.*)/;

// 重试配置
const MAX_RETRIES = 3;
const RETRY_DELAYS = [3_000, 10_000, 30_000]; // 3s, 10s, 30s

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

    const { startListening, addSmsListener, setStaticReceiverEnabled } =
      await import('sms-forwarder');

    setStaticReceiverEnabled(true);
    startListening();
    this.subscription = addSmsListener((event) => {
      this.handleSmsReceived(event.from, event.body);
    });
    this.enabled = true;
    console.log('[SmsCodeService] Enabled - listening for SMS');
  }

  async disable(): Promise<void> {
    if (!this.enabled) return;

    if (Platform.OS === 'android') {
      const { setStaticReceiverEnabled } = await import('sms-forwarder');
      setStaticReceiverEnabled(false);
    }

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
      const debugSmsNotify = useSettingsStore.getState().config?.debugSmsNotify;
      if (debugSmsNotify) {
        const preview = body.length > 30 ? body.slice(0, 30) + '…' : body;
        ToastAndroid.show(`短信不含验证码: ${preview}`, ToastAndroid.SHORT);
      }
      return;
    }

    console.log(`[SmsCodeService] Verification code extracted: ${code}`);

    // 1. 复制验证码到本地剪贴板（锁屏时部分设备可能失败，不阻塞上传）
    try {
      await Clipboard.setStringAsync(code);
      console.log(`[SmsCodeService] Copied verification code to clipboard: ${code}`);
    } catch (clipError) {
      console.warn('[SmsCodeService] Failed to copy to clipboard (screen locked?):', clipError);
    }

    // 2. 构建内容并通过同步流程上传（复用 hash 去重逻辑）
    const syncManager = SyncManager.getInstance();
    try {
      const profileHash = await calculateTextHash(code);

      const content: ClipboardContent = {
        type: 'Text',
        text: code,
        profileHash,
        localClipboardHash: profileHash,
        timestamp: Date.now(),
      };

      if (!syncManager.getAPIClient()) {
        console.warn('[SmsCodeService] No API client available, cannot upload verification code');
        return;
      }

      await this.uploadWithRetry(syncManager, content, code);
    } catch (error) {
      console.error('[SmsCodeService] Failed to upload verification code:', error);
    } finally {
      syncManager.setPendingUploadContent(null);
    }
  }

  /**
   * 带重试的上传（应对 Doze 模式下网络限制）
   */
  private async uploadWithRetry(
    syncManager: SyncManager,
    content: ClipboardContent,
    code: string
  ): Promise<void> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      syncManager.setPendingUploadContent(content);
      const result = await syncManager.sync(SyncDirection.Upload, false);

      if (result.success && !result.skipped) {
        console.log(`[SmsCodeService] Verification code uploaded: ${code}`);
        ToastAndroid.show(`已上传验证码: ${code}`, ToastAndroid.SHORT);
        syncManager.updateForegroundNotification(`已上传验证码: ${code}`);
        return;
      }

      if (result.skipped) {
        console.log(`[SmsCodeService] Upload skipped (already synced): ${code}`);
        return;
      }

      // 上传失败 — 如果还有重试次数，等待后重试
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
        console.warn(
          `[SmsCodeService] Upload failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${result.error}, retrying in ${delay}ms`
        );
        syncManager.updateForegroundNotification(
          `验证码上传重试中: ${code}\n第${attempt + 1}次失败，${Math.round(delay / 1000)}秒后重试…`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));

        // 重试前检查服务是否仍然启用
        if (!this.enabled) {
          console.log('[SmsCodeService] Service disabled during retry, aborting');
          return;
        }
      } else {
        console.warn(
          `[SmsCodeService] Upload failed after ${MAX_RETRIES + 1} attempts: ${result.error}`
        );
        syncManager.updateForegroundNotification(
          `验证码上传失败: ${code}\n已重试${MAX_RETRIES}次，${result.error ?? '未知错误'}`
        );
      }
    }
  }
}

export function getSmsCodeService(): SmsCodeService {
  return SmsCodeService.getInstance();
}
