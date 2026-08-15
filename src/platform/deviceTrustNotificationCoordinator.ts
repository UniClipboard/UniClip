import { sha256 } from 'js-sha256';

import type { DeviceTrustSnapshot } from '@/platform/engine';
import type { DeviceTrustQueryState } from '@/features/space/store';

const STORAGE_KEY = 'uniclip.space-notification-episodes.v1';

export const DEVICE_TRUST_NOTIFICATION_CONTENT = {
  title: 'UniClip',
  body: 'Review an important Space update in the app.',
  data: { kind: 'reviewCurrentChange' },
} as const;

export type SpaceNavigationIntent =
  | { kind: 'reviewCurrentChange' }
  | {
      kind: 'openDevice';
      condition: 'upgradeRequired' | 'unverifiable';
      fingerprint: string;
    }
  | { kind: 'openSpaceManagement'; reason: 'unverifiable' };

export type SpaceNavigationDestination =
  | { kind: 'reviewCurrentChange' }
  | { kind: 'openDevice'; deviceId: string }
  | { kind: 'openSpaceManagement' }
  | { kind: 'home' };

export interface DeviceTrustNotificationEpisode {
  kind: 'reviewCurrentChange' | 'upgradeRequired' | 'unverifiable';
  fingerprint: string;
  intent: SpaceNavigationIntent;
}

export interface DeviceTrustNotificationDriver {
  hasPermission(): Promise<boolean>;
  notify(episode: DeviceTrustNotificationEpisode): Promise<void>;
}

export interface DeviceTrustNotificationStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

interface DeviceTrustNotificationObservationOptions {
  suppressNewEpisodes?: boolean;
}

function memoryStorage(): DeviceTrustNotificationStorage {
  let value: string | null = null;
  return {
    async getItem() {
      return value;
    },
    async setItem(_key, next) {
      value = next;
    },
  };
}

function fingerprint(value: string): string {
  return sha256(value);
}

export function parseSpaceNavigationIntent(value: unknown): SpaceNavigationIntent | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.kind === 'reviewCurrentChange') return { kind: 'reviewCurrentChange' };
  if (data.kind === 'openSpaceManagement' && data.reason === 'unverifiable') {
    return { kind: 'openSpaceManagement', reason: 'unverifiable' };
  }
  if (
    data.kind === 'openDevice' &&
    (data.condition === 'upgradeRequired' || data.condition === 'unverifiable') &&
    typeof data.fingerprint === 'string'
  ) {
    return {
      kind: 'openDevice',
      condition: data.condition,
      fingerprint: data.fingerprint,
    };
  }
  return null;
}

function snapshotFromQuery(query: DeviceTrustQueryState): DeviceTrustSnapshot | null {
  if (query.kind === 'ready') return query.snapshot;
  if (query.kind === 'loading') return query.previous;
  return null;
}

function episodes(query: DeviceTrustQueryState): DeviceTrustNotificationEpisode[] {
  if (query.kind === 'corrupt') {
    const value = fingerprint('unverifiable:corrupt');
    return [
      {
        kind: 'unverifiable',
        fingerprint: value,
        intent: { kind: 'openSpaceManagement', reason: 'unverifiable' },
      },
    ];
  }

  const snapshot = snapshotFromQuery(query);
  if (!snapshot) return [];
  const result: DeviceTrustNotificationEpisode[] = [];
  const changeId = snapshot.currentChange?.changeId;
  if (changeId) {
    result.push({
      kind: 'reviewCurrentChange',
      fingerprint: fingerprint(`review:${changeId}`),
      intent: { kind: 'reviewCurrentChange' },
    });
  }
  for (const device of snapshot.devices) {
    if (
      device.compatibility === 'upgradeRequired' ||
      device.syncRelationship === 'pausedUpgradeRequired'
    ) {
      const value = fingerprint(`upgrade:${device.deviceId}`);
      result.push({
        kind: 'upgradeRequired',
        fingerprint: value,
        intent: { kind: 'openDevice', condition: 'upgradeRequired', fingerprint: value },
      });
    }
    if (
      device.groupRelationship === 'unverifiable' ||
      device.syncRelationship === 'pausedUnverifiable'
    ) {
      const value = fingerprint(`unverifiable:${device.deviceId}`);
      result.push({
        kind: 'unverifiable',
        fingerprint: value,
        intent: { kind: 'openDevice', condition: 'unverifiable', fingerprint: value },
      });
    }
  }
  return result;
}

export function resolveSpaceNavigationIntent(
  intent: SpaceNavigationIntent,
  spaceId: string | null,
  query: DeviceTrustQueryState
): SpaceNavigationDestination {
  if (!spaceId || query.kind === 'notApplicable') return { kind: 'home' };
  const snapshot = snapshotFromQuery(query);
  if (intent.kind === 'reviewCurrentChange') {
    return snapshot?.currentChange
      ? { kind: 'reviewCurrentChange' }
      : { kind: 'openSpaceManagement' };
  }
  if (intent.kind === 'openSpaceManagement') return { kind: 'openSpaceManagement' };
  if (!snapshot) return { kind: 'openSpaceManagement' };

  const match = snapshot.devices.find((device) => {
    if (device.membership === 'removed' || device.groupRelationship === 'diverged') return false;
    const value =
      intent.condition === 'upgradeRequired'
        ? fingerprint(`upgrade:${device.deviceId}`)
        : fingerprint(`unverifiable:${device.deviceId}`);
    const conditionStillApplies =
      intent.condition === 'upgradeRequired'
        ? device.compatibility === 'upgradeRequired' ||
          device.syncRelationship === 'pausedUpgradeRequired'
        : device.groupRelationship === 'unverifiable' ||
          device.syncRelationship === 'pausedUnverifiable';
    return conditionStillApplies && value === intent.fingerprint;
  });
  return match ? { kind: 'openDevice', deviceId: match.deviceId } : { kind: 'openSpaceManagement' };
}

export interface DeviceTrustNotificationResponseDependencies {
  refresh(): Promise<void>;
  getCurrentState(): Pick<
    import('@/features/space/store').UnifiedSpaceSnapshot,
    'spaceId' | 'deviceTrustQuery'
  >;
  navigate(destination: SpaceNavigationDestination): void;
  clearResponse(): Promise<void>;
}

export class DeviceTrustNotificationResponseCoordinator {
  private queue = Promise.resolve();
  private readonly responses = new Map<string, Promise<void>>();
  private readonly completed = new Set<string>();

  constructor(private readonly dependencies: DeviceTrustNotificationResponseDependencies) {}

  handle(responseId: string, intent: SpaceNavigationIntent): Promise<void> {
    if (this.completed.has(responseId)) return Promise.resolve();
    const existing = this.responses.get(responseId);
    if (existing) return existing;
    const response = this.queue.then(async () => {
      await this.dependencies.refresh();
      const current = this.dependencies.getCurrentState();
      this.dependencies.navigate(
        resolveSpaceNavigationIntent(intent, current.spaceId, current.deviceTrustQuery)
      );
      await this.dependencies.clearResponse();
      this.completed.add(responseId);
    });
    this.responses.set(responseId, response);
    this.queue = response.catch(() => undefined);
    void response.then(
      () => this.responses.delete(responseId),
      () => this.responses.delete(responseId)
    );
    return response;
  }
}

function parseStoredFingerprints(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
      return new Set();
    }
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export class DeviceTrustNotificationCoordinator {
  private activeFingerprints: Set<string> | null = null;
  private observationQueue = Promise.resolve();

  constructor(
    private readonly driver: DeviceTrustNotificationDriver,
    private readonly storage: DeviceTrustNotificationStorage = memoryStorage()
  ) {}

  observe(
    query: DeviceTrustQueryState,
    options: DeviceTrustNotificationObservationOptions = {}
  ): Promise<void> {
    const observation = this.observationQueue.then(() => this.observeSerially(query, options));
    this.observationQueue = observation.catch(() => undefined);
    return observation;
  }

  private async observeSerially(
    query: DeviceTrustQueryState,
    options: DeviceTrustNotificationObservationOptions
  ): Promise<void> {
    if (!this.activeFingerprints) {
      try {
        this.activeFingerprints = parseStoredFingerprints(await this.storage.getItem(STORAGE_KEY));
      } catch {
        this.activeFingerprints = new Set();
      }
    }

    if (
      query.kind === 'idle' ||
      query.kind === 'unavailable' ||
      query.kind === 'failed' ||
      (query.kind === 'loading' && !query.previous)
    ) {
      return;
    }

    const currentEpisodes = episodes(query);
    const currentFingerprints = new Set(currentEpisodes.map((episode) => episode.fingerprint));
    const newEpisodes = currentEpisodes.filter(
      (episode) => !this.activeFingerprints?.has(episode.fingerprint)
    );
    this.activeFingerprints = currentFingerprints;
    try {
      await this.storage.setItem(STORAGE_KEY, JSON.stringify([...currentFingerprints].sort()));
    } catch {
      // Notification storage must not affect the in-app decision flow.
    }
    if (
      options.suppressNewEpisodes ||
      newEpisodes.length === 0 ||
      !(await this.driver.hasPermission())
    ) {
      return;
    }
    for (const episode of newEpisodes) await this.driver.notify(episode);
  }
}
