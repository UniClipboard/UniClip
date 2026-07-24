import type { SyncConnectionTarget } from '@/types/settings';

export type SyncConnectionSelectionResult = { ok: true } | { ok: false; error: string };

export interface P2pSpaceSetupDependencies {
  getSelectedTarget(): SyncConnectionTarget;
  select(target: SyncConnectionTarget): Promise<SyncConnectionSelectionResult>;
  activateSelected(): Promise<void>;
}

export class P2pSpaceSetupCoordinator {
  constructor(private readonly dependencies: P2pSpaceSetupDependencies) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previousTarget = this.dependencies.getSelectedTarget();
    const switched = previousTarget.kind !== 'p2p';

    if (switched) {
      const selection = await this.dependencies.select({ kind: 'p2p' });
      if (!selection.ok) throw new Error(selection.error);
    }

    try {
      await this.dependencies.activateSelected();
      return await operation();
    } catch (error) {
      if (switched) {
        const rollback = await this.dependencies.select(previousTarget);
        if (rollback.ok) await this.dependencies.activateSelected();
      }
      throw error;
    }
  }
}

let sharedCoordinator: P2pSpaceSetupCoordinator | null = null;

export function getP2pSpaceSetupCoordinator(): P2pSpaceSetupCoordinator {
  if (!sharedCoordinator) {
    sharedCoordinator = new P2pSpaceSetupCoordinator({
      getSelectedTarget: () => {
        const { useSettingsStore } = require('../stores/settingsStore');
        const config = useSettingsStore.getState().config;
        if (!config || config.syncChannel === 'p2p') return { kind: 'p2p' };
        return { kind: 'lan', serverIndex: config.activeServerIndex };
      },
      select: (target) => {
        const { useSettingsStore } = require('../stores/settingsStore');
        return useSettingsStore.getState().selectSyncConnection(target);
      },
      activateSelected: () => {
        const { getBackgroundServiceManager } = require('./BackgroundServiceManager');
        return getBackgroundServiceManager().activateSelectedSyncChannel();
      },
    });
  }
  return sharedCoordinator;
}
