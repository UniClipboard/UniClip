import {
  DeviceTrustNotificationCoordinator,
  DeviceTrustNotificationResponseCoordinator,
  DEVICE_TRUST_NOTIFICATION_CONTENT,
  resolveSpaceNavigationIntent,
} from '@/platform/deviceTrustNotificationCoordinator';
import type { DeviceTrustSnapshot } from '@/platform/engine';
import type { DeviceTrustQueryState } from '@/features/space/store';
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
        groupRelationship: 'consistent',
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
  function ready(value: DeviceTrustSnapshot): DeviceTrustQueryState {
    return { kind: 'ready', snapshot: value };
  }

  function memoryStorage() {
    let value: string | null = null;
    return {
      getItem: jest.fn(async () => value),
      setItem: jest.fn(async (_key: string, next: string) => {
        value = next;
      }),
      value: () => value,
    };
  }

  it('notifies each current change at most once per runtime', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const coordinator = new DeviceTrustNotificationCoordinator({
      hasPermission: jest.fn().mockResolvedValue(true),
      notify,
    });

    await Promise.all([
      coordinator.observe(ready(snapshot('change-1'))),
      coordinator.observe(ready(snapshot('change-1'))),
    ]);
    await coordinator.observe(ready(snapshot('change-2')));

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('does not notify ordinary state without a pending decision', async () => {
    const notify = jest.fn();
    const hasPermission = jest.fn();
    const coordinator = new DeviceTrustNotificationCoordinator({ hasPermission, notify });

    await coordinator.observe(ready(snapshot(null)));

    expect(hasPermission).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not request or send when notification permission is unavailable', async () => {
    const notify = jest.fn();
    const hasPermission = jest.fn().mockResolvedValue(false);
    const coordinator = new DeviceTrustNotificationCoordinator({ hasPermission, notify });

    await coordinator.observe(ready(snapshot('change-denied')));

    expect(hasPermission).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('persists only hashed active episodes and deduplicates across coordinator restarts', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const storage = memoryStorage();
    const driver = { hasPermission: jest.fn().mockResolvedValue(true), notify };

    await new DeviceTrustNotificationCoordinator(driver, storage).observe(
      ready(snapshot('change-secret'))
    );
    await new DeviceTrustNotificationCoordinator(driver, storage).observe(
      ready(snapshot('change-secret'))
    );

    expect(notify).toHaveBeenCalledTimes(1);
    expect(storage.value()).not.toContain('change-secret');
    expect(storage.value()).not.toContain('phone-secret-id');
  });

  it('does not clear persisted episodes while the current trust state is still unknown', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const storage = memoryStorage();
    const driver = { hasPermission: jest.fn().mockResolvedValue(true), notify };
    const upgrade = snapshot(null);
    upgrade.devices[0]!.compatibility = 'upgradeRequired';
    upgrade.devices[0]!.syncRelationship = 'pausedUpgradeRequired';

    await new DeviceTrustNotificationCoordinator(driver, storage).observe(ready(upgrade));
    const restarted = new DeviceTrustNotificationCoordinator(driver, storage);
    await restarted.observe({ kind: 'idle' });
    await restarted.observe({
      kind: 'failed',
      failure: {
        operation: 'queryDeviceTrust',
        code: 1393,
        category: 'invalidState',
        retryable: false,
      },
    });
    await restarted.observe(ready(upgrade));

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('records user-operation outcomes without notifying about their new episodes', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const storage = memoryStorage();
    const driver = { hasPermission: jest.fn().mockResolvedValue(true), notify };
    const coordinator = new DeviceTrustNotificationCoordinator(driver, storage);
    const upgrade = snapshot(null);
    upgrade.devices[0]!.compatibility = 'upgradeRequired';
    upgrade.devices[0]!.syncRelationship = 'pausedUpgradeRequired';

    await coordinator.observe(ready(upgrade), { suppressNewEpisodes: true });
    await coordinator.observe(ready(upgrade));

    expect(notify).not.toHaveBeenCalled();
    expect(storage.value()).not.toBeNull();
  });

  it('notifies upgrade and explicit unverifiable episodes but not ordinary query failures', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const coordinator = new DeviceTrustNotificationCoordinator({
      hasPermission: jest.fn().mockResolvedValue(true),
      notify,
    });
    const upgrade = snapshot(null);
    upgrade.devices[0]!.compatibility = 'upgradeRequired';
    upgrade.devices[0]!.syncRelationship = 'pausedUpgradeRequired';

    await coordinator.observe(ready(upgrade));
    await coordinator.observe({
      kind: 'failed',
      failure: {
        operation: 'queryDeviceTrust',
        code: 1393,
        category: 'invalidState',
        retryable: false,
      },
    });
    await coordinator.observe({
      kind: 'corrupt',
      failure: {
        operation: 'queryDeviceTrust',
        code: 1394,
        category: 'invalidState',
        retryable: false,
      },
    });

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.map(([episode]) => episode.kind)).toEqual([
      'upgradeRequired',
      'unverifiable',
    ]);
  });

  it('allows a recovered episode to notify again when it reappears', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const coordinator = new DeviceTrustNotificationCoordinator({
      hasPermission: jest.fn().mockResolvedValue(true),
      notify,
    });
    const upgrade = snapshot(null);
    upgrade.devices[0]!.compatibility = 'upgradeRequired';
    upgrade.devices[0]!.syncRelationship = 'pausedUpgradeRequired';

    await coordinator.observe(ready(upgrade));
    await coordinator.observe(ready(snapshot(null)));
    await coordinator.observe(ready(upgrade));

    expect(notify).toHaveBeenCalledTimes(2);
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
    expect(DEVICE_TRUST_NOTIFICATION_CONTENT.data).toEqual({ kind: 'reviewCurrentChange' });
  });

  it('keeps platform drivers permission-preserving and observes the unified snapshot', () => {
    const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
    const app = source('App.tsx');
    const observer = source('src/components/DeviceTrustNotificationObserver.tsx');

    for (const platform of ['android', 'ios']) {
      const driver = source(`src/platform/deviceTrustNotifications.${platform}.ts`);
      expect(driver).toContain('getPermissionsAsync');
      expect(driver).not.toContain('requestPermissionsAsync');
      expect(driver).toContain('episode.intent');
      expect(driver).not.toContain("kind: 'deviceTrustReview'");
      expect(driver).toContain('getLastNotificationResponse()');
      expect(driver).toContain('addNotificationResponseReceivedListener');
      expect(driver).toContain('clearLastNotificationResponse()');
    }
    expect(observer).toContain('state.deviceTrustQuery');
    expect(observer).toContain('state.operationState');
    expect(observer).toContain('suppressNewEpisodes');
    expect(observer).toContain('notificationNavigationRequestId');
    expect(observer).toContain("navigateWhenReady('Settings'");
    expect(app).toContain('<DeviceTrustNotificationObserver />');
  });

  it('provides distinct private copy for all three notification kinds in every language', () => {
    const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
    for (const locale of ['en', 'pt-BR', 'ru', 'zh']) {
      const messages = JSON.parse(source(`src/i18n/locales/${locale}/settingsSync.json`));
      for (const kind of ['Review', 'Upgrade', 'Unverifiable']) {
        expect(messages.space.deviceTrust[`notification${kind}Title`]).toEqual(expect.any(String));
        expect(messages.space.deviceTrust[`notification${kind}Body`]).toEqual(expect.any(String));
      }
    }
  });

  it('resolves an opaque device intent only against the refreshed current state', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const coordinator = new DeviceTrustNotificationCoordinator({
      hasPermission: jest.fn().mockResolvedValue(true),
      notify,
    });
    const upgrade = snapshot(null);
    upgrade.devices[0]!.compatibility = 'upgradeRequired';
    upgrade.devices[0]!.syncRelationship = 'pausedUpgradeRequired';
    await coordinator.observe(ready(upgrade));
    const intent = notify.mock.calls[0]![0].intent;

    expect(resolveSpaceNavigationIntent(intent, 'space-1', ready(upgrade))).toEqual({
      kind: 'openDevice',
      deviceId: 'phone-secret-id',
    });
    expect(resolveSpaceNavigationIntent(intent, 'space-1', ready(snapshot(null)))).toEqual({
      kind: 'openSpaceManagement',
    });
    expect(resolveSpaceNavigationIntent(intent, null, { kind: 'notApplicable' })).toEqual({
      kind: 'home',
    });
  });

  it('refreshes before navigating and consumes the same notification response only once', async () => {
    const query = ready(snapshot('change-latest'));
    const order: string[] = [];
    const navigate = jest.fn(() => order.push('navigate'));
    const clearResponse = jest.fn(async () => {
      order.push('clear');
    });
    const coordinator = new DeviceTrustNotificationResponseCoordinator({
      refresh: jest.fn(async () => {
        order.push('refresh');
      }),
      getCurrentState: () => ({ spaceId: 'space-1', deviceTrustQuery: query }),
      navigate,
      clearResponse,
    });

    await Promise.all([
      coordinator.handle('response-1', { kind: 'reviewCurrentChange' }),
      coordinator.handle('response-1', { kind: 'reviewCurrentChange' }),
    ]);

    expect(order).toEqual(['refresh', 'navigate', 'clear']);
    expect(navigate).toHaveBeenCalledWith({ kind: 'reviewCurrentChange' });
  });
});
