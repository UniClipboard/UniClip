import { useEffect } from 'react';

import { useUnifiedSpaceStore } from '@/features/space';

export function DeviceTrustNotificationObserver() {
  const deviceTrust = useUnifiedSpaceStore((state) => state.deviceTrust);

  useEffect(() => {
    if (!deviceTrust?.currentChange) return;
    void import('@/platform/deviceTrustNotifications')
      .then(({ getDeviceTrustNotificationCoordinator }) =>
        getDeviceTrustNotificationCoordinator().observe(deviceTrust)
      )
      .catch(() => undefined);
  }, [deviceTrust]);

  return null;
}
