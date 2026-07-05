/**
 * 短信自动化 section（仅 Android）
 *
 * 自动上传短信验证码开关，开启时申请短信接收权限并同步静态接收器状态。
 * 作为 item：无独立 Host，外壳(标题 + Card + Column)由 SettingsSectionItem 提供。
 */
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Alert, Linking } from 'react-native';
import { ListItem, Switch as ComposeSwitch, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';

export const SmsSection = memo(function SmsSection() {
  const { t } = useTranslation('settingsPermissions');
  const showMessage = useSettingsToast();
  const smsForwardingEnabled = useSettingsStore((s) => s.config?.enableSmsForwarding ?? false);

  const handleToggleSmsForwarding = async (enabled: boolean) => {
    if (enabled && Platform.OS === 'android') {
      const { PermissionsAndroid } = require('react-native');
      const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
      if (!granted) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(
            t('smsAutomation.permissionRequiredTitle'),
            t('smsAutomation.permissionRequiredMessage'),
            [
              { text: t('action.cancel', { ns: 'common' }), style: 'cancel' },
              { text: t('action.openSettings'), onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }
      }
    }

    try {
      await useSettingsStore.getState().setEnableSmsForwarding(enabled);
      if (Platform.OS === 'android') {
        const { setStaticReceiverEnabled } = await import('sms-forwarder');
        setStaticReceiverEnabled(enabled);
      }
      showMessage(
        enabled ? t('smsAutomation.enabledToast') : t('smsAutomation.disabledToast'),
        'success'
      );
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('smsAutomation.saveFailed'), 'error');
    }
  };

  if (Platform.OS !== 'android') return null;

  return (
    <SettingsSectionItem title={t('smsAutomation.title')}>
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('smsAutomation.autoUpload')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <ComposeSwitch value={smsForwardingEnabled} onCheckedChange={handleToggleSmsForwarding} />
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
