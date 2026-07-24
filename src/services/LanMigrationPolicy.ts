import type { SyncChannel } from '../types/settings';

export interface LanMigrationState {
  legacyLanEligible: boolean;
  syncChannel: SyncChannel;
  lanMigrationPromptedVersion: string | null;
}

export function shouldShowLanMigrationPrompt(
  state: LanMigrationState,
  appVersion: string,
  hasP2pSpace: boolean
): boolean {
  return (
    state.legacyLanEligible &&
    state.syncChannel === 'lan' &&
    !hasP2pSpace &&
    state.lanMigrationPromptedVersion !== appVersion
  );
}
