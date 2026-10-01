/**
 * 「复制短信验证码」开关的状态与权限流程(仅 Android)。
 *
 * 默认关闭,由用户手动开启:先申请 RECEIVE_SMS(不申请 READ_SMS),再请求通知权限
 * (Android 13+,被拒绝时仍可复制,只是没有通知),最后启用原生接收器。开关状态直接读原生:
 * 用户在系统设置里撤销短信权限后,回到前台会显示为关闭。
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isSmsCodeAutoCopyEnabled, setSmsCodeAutoCopyEnabled } from 'sms-verification-code';
import { useSettingsToast } from '../SettingsToastContext';

function readEnabled(): boolean {
  try {
    return isSmsCodeAutoCopyEnabled();
  } catch {
    return false;
  }
}

export function useSmsCodeAutoCopy() {
  const { t } = useTranslation('settingsBackground');
  const showMessage = useSettingsToast();
  const [enabled, setEnabled] = useState(readEnabled);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setEnabled(readEnabled());
    });
    return () => sub.remove();
  }, []);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!next) {
        setSmsCodeAutoCopyEnabled(false);
        setEnabled(false);
        showMessage(t('smsCode.disabled'), 'success');
        return;
      }
      const sms = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
      if (sms !== PermissionsAndroid.RESULTS.GRANTED) {
        setEnabled(false);
        showMessage(t('smsCode.denied'), 'error');
        return;
      }
      if (Number(Platform.Version) >= 33) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      const ok = setSmsCodeAutoCopyEnabled(true);
      setEnabled(ok);
      showMessage(ok ? t('smsCode.enabled') : t('smsCode.denied'), ok ? 'success' : 'error');
    },
    [showMessage, t]
  );

  return { enabled, toggle };
}
