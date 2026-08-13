import * as Notifications from 'expo-notifications';

import i18n from '@/i18n';
import { DeviceTrustNotificationCoordinator } from './deviceTrustNotificationCoordinator';

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
    await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('space.deviceTrust.notificationTitle', { ns: 'settingsSync' }),
        body: i18n.t('space.deviceTrust.notificationBody', { ns: 'settingsSync' }),
        data: { kind: 'deviceTrustReview' },
        sound: false,
      },
      trigger: null,
    });
  },
});

export function getDeviceTrustNotificationCoordinator() {
  return coordinator;
}
