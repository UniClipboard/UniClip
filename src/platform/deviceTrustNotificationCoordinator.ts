import type { DeviceTrustSnapshot } from '@/platform/engine';

export const DEVICE_TRUST_NOTIFICATION_CONTENT = {
  title: 'UniClip',
  body: 'Review a device change in the app.',
  data: { kind: 'deviceTrustReview' },
} as const;

export interface DeviceTrustNotificationDriver {
  hasPermission(): Promise<boolean>;
  notify(): Promise<void>;
}

export class DeviceTrustNotificationCoordinator {
  private readonly seenChangeIds = new Set<string>();

  constructor(private readonly driver: DeviceTrustNotificationDriver) {}

  async observe(snapshot: DeviceTrustSnapshot | null): Promise<void> {
    const changeId = snapshot?.currentChange?.changeId;
    if (!changeId || this.seenChangeIds.has(changeId)) return;

    this.seenChangeIds.add(changeId);
    if (!(await this.driver.hasPermission())) return;
    await this.driver.notify();
  }
}
