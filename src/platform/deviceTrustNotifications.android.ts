import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n from '@/i18n';
import {
  DeviceTrustNotificationCoordinator,
  parseSpaceNavigationIntent,
  type SpaceNavigationIntent,
} from './deviceTrustNotificationCoordinator';

const CHANNEL_ID = 'device-trust-review';

function notificationCopy(kind: 'reviewCurrentChange' | 'upgradeRequired' | 'unverifiable') {
  const key =
    kind === 'reviewCurrentChange'
      ? 'Review'
      : kind === 'upgradeRequired'
      ? 'Upgrade'
      : 'Unverifiable';
  return {
    title: i18n.t(`space.deviceTrust.notification${key}Title`, { ns: 'settingsSync' }),
    body: i18n.t(`space.deviceTrust.notification${key}Body`, { ns: 'settingsSync' }),
  };
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const coordinator = new DeviceTrustNotificationCoordinator(
  {
    async hasPermission() {
      const permissions = await Notifications.getPermissionsAsync();
      return permissions.granted || permissions.status === 'granted';
    },
    async notify(episode) {
      const copy = notificationCopy(episode.kind);
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
          title: copy.title,
          body: copy.body,
          data: episode.intent,
          sound: false,
        },
        trigger: { channelId: CHANNEL_ID },
      });
    },
  },
  AsyncStorage
);

export function getDeviceTrustNotificationCoordinator() {
  return coordinator;
}

export function observeDeviceTrustNotificationResponses(
  listener: (responseId: string, intent: SpaceNavigationIntent) => void
): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    if (!response) return;
    const intent = parseSpaceNavigationIntent(response.notification.request.content.data);
    if (intent) listener(response.notification.request.identifier, intent);
  };
  handle(Notifications.getLastNotificationResponse());
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}

export async function clearDeviceTrustNotificationResponse(): Promise<void> {
  Notifications.clearLastNotificationResponse();
}
