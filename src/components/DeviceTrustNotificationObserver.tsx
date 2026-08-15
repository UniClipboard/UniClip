import { useEffect } from 'react';

import { getUnifiedSpaceService, useUnifiedSpaceStore } from '@/features/space';
import { navigateWhenReady } from '@/navigation/navigationRef';
import {
  DeviceTrustNotificationResponseCoordinator,
  type SpaceNavigationDestination,
} from '@/platform/deviceTrustNotificationCoordinator';

let notificationNavigationRequestId = 0;

function navigate(destination: SpaceNavigationDestination) {
  notificationNavigationRequestId += 1;
  if (destination.kind === 'openDevice') {
    navigateWhenReady('Settings', {
      section: 'space',
      deviceId: destination.deviceId,
      notificationNavigationRequestId,
    });
    return;
  }
  if (destination.kind === 'openSpaceManagement') {
    navigateWhenReady('Settings', { section: 'space', notificationNavigationRequestId });
    return;
  }
  navigateWhenReady('Main');
}

const responseCoordinator = new DeviceTrustNotificationResponseCoordinator({
  refresh: async () => {
    await getUnifiedSpaceService().refresh();
  },
  getCurrentState: () => useUnifiedSpaceStore.getState(),
  navigate,
  clearResponse: async () => {
    const notifications = await import('@/platform/deviceTrustNotifications');
    await notifications.clearDeviceTrustNotificationResponse();
  },
});

export function DeviceTrustNotificationObserver() {
  const deviceTrustQuery = useUnifiedSpaceStore((state) => state.deviceTrustQuery);
  const operationState = useUnifiedSpaceStore((state) => state.operationState);

  useEffect(() => {
    void import('@/platform/deviceTrustNotifications')
      .then(({ getDeviceTrustNotificationCoordinator }) =>
        getDeviceTrustNotificationCoordinator().observe(deviceTrustQuery, {
          suppressNewEpisodes: operationState.kind === 'result',
        })
      )
      .catch(() => undefined);
  }, [deviceTrustQuery, operationState.kind]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let active = true;
    void import('@/platform/deviceTrustNotifications')
      .then((notifications) => {
        if (!active) return;
        cleanup = notifications.observeDeviceTrustNotificationResponses((responseId, intent) => {
          void responseCoordinator.handle(responseId, intent).catch(() => undefined);
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  return null;
}
