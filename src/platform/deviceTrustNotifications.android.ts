import * as Notifications from 'expo-notifications';

import i18n from '@/i18n';
import { DeviceTrustNotificationCoordinator } from './deviceTrustNotificationCoordinator';

const CHANNEL_ID = 'device-trust-review';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const coordinator = new DeviceTrustNotificationCoordinator({
  async hasPermission() {
    const permissions = await Notifications.getPermissionsAsync();
    return permissions.granted || permissions.status === 'granted';
  },
  async notify() {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: i18n.t('space.deviceTrust.notificationChannel', { ns: 'settingsSync' }),
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
      vibrationPattern: null,
      enableVibrate: false,
      showBadge: false,
    });
    await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('space.deviceTrust.notificationTitle', { ns: 'settingsSync' }),
        body: i18n.t('space.deviceTrust.notificationBody', { ns: 'settingsSync' }),
        data: { kind: 'deviceTrustReview' },
        sound: false,
      },
      trigger: { channelId: CHANNEL_ID },
    });
  },
});

export function getDeviceTrustNotificationCoordinator() {
  return coordinator;
}
