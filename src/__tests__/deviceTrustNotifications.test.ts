import {
  DeviceTrustNotificationCoordinator,
  DEVICE_TRUST_NOTIFICATION_CONTENT,
} from '@/platform/deviceTrustNotificationCoordinator';
import type { DeviceTrustSnapshot } from '@/platform/engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function snapshot(changeId: string | null): DeviceTrustSnapshot {
  return {
    revision: 4,
    localDeviceId: 'phone-secret-id',
    localMembership: 'active',
    currentChange: changeId
      ? {
          changeId,
          proposedByDeviceId: 'desktop-secret-id',
          targetDeviceIds: ['tablet-secret-id'],
          includesLocalDevice: false,
          applyImpact: {
            usableDeviceIds: ['desktop-secret-id'],
            pausedDeviceIds: ['tablet-secret-id'],
            localDeviceOutcome: 'active',
            requiresRejoinDeviceIds: [],
          },
          keepCurrentImpact: {
            usableDeviceIds: ['phone-secret-id'],
            pausedDeviceIds: ['desktop-secret-id'],
            localDeviceOutcome: 'active',
            requiresRejoinDeviceIds: ['desktop-secret-id'],
          },
          allowedChoices: ['applyChange', 'keepCurrentDeviceGroup'],
          blockedReason: null,
        }
      : null,
    devices: [
      {
        deviceId: 'phone-secret-id',
        displayName: 'Mark Phone',
        isLocal: true,
        reachability: 'online',
        membership: 'active',
        groupRelationship: 'sameGroup',
        compatibility: 'compatible',
        syncRelationship: 'usable',
        availableActions: [],
        blockedReason: null,
      },
    ],
    recovery: 'notAvailableInThisVersion',
    allowedActions: [],
    blockedReason: null,
    updatedAtMs: 1,
  };
}

describe('DeviceTrustNotificationCoordinator', () => {
  it('notifies each current change at most once per runtime', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const coordinator = new DeviceTrustNotificationCoordinator({
      hasPermission: jest.fn().mockResolvedValue(true),
      notify,
    });

    await Promise.all([
      coordinator.observe(snapshot('change-1')),
      coordinator.observe(snapshot('change-1')),
    ]);
    await coordinator.observe(snapshot('change-2'));

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('does not notify ordinary state without a pending decision', async () => {
    const notify = jest.fn();
    const hasPermission = jest.fn();
    const coordinator = new DeviceTrustNotificationCoordinator({ hasPermission, notify });

    await coordinator.observe(snapshot(null));

    expect(hasPermission).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not request or send when notification permission is unavailable', async () => {
    const notify = jest.fn();
    const hasPermission = jest.fn().mockResolvedValue(false);
    const coordinator = new DeviceTrustNotificationCoordinator({ hasPermission, notify });

    await coordinator.observe(snapshot('change-denied'));

    expect(hasPermission).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('uses generic content without device or relationship details', () => {
    const serialized = JSON.stringify(DEVICE_TRUST_NOTIFICATION_CONTENT);

    for (const sensitive of [
      'Mark Phone',
      'phone-secret-id',
      'desktop-secret-id',
      'tablet-secret-id',
      'change-1',
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
    expect(DEVICE_TRUST_NOTIFICATION_CONTENT.data).toEqual({ kind: 'deviceTrustReview' });
  });

  it('keeps platform drivers permission-preserving and observes the unified snapshot', () => {
    const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
    const app = source('App.tsx');
    const observer = source('src/components/DeviceTrustNotificationObserver.tsx');

    for (const platform of ['android', 'ios']) {
      const driver = source(`src/platform/deviceTrustNotifications.${platform}.ts`);
      expect(driver).toContain('getPermissionsAsync');
      expect(driver).not.toContain('requestPermissionsAsync');
      expect(driver).toContain("data: { kind: 'deviceTrustReview' }");
    }
    expect(observer).toContain('state.deviceTrust');
    expect(app).toContain('<DeviceTrustNotificationObserver />');
  });
});
