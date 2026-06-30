import { Platform } from 'react-native';
import { useSettingsStore } from '../stores/settingsStore';
import { getAppGroupSyncSnapshot, syncConfigToAppGroup } from './appGroupSyncCore';
import { log } from './Logger';

export * from './appGroupSyncCore';

type Unsubscribe = () => void;

let unsubscribe: Unsubscribe | null = null;
let lastSnapshot = '';

export function startAppGroupSync(): Unsubscribe {
  if (Platform.OS !== 'ios') {
    return () => {};
  }
  if (unsubscribe) {
    return unsubscribe;
  }

  const pushConfig = (config = useSettingsStore.getState().config) => {
    const snapshot = getAppGroupSyncSnapshot(config);
    if (!snapshot || snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;

    syncConfigToAppGroup(config).catch((error) => {
      log.warn('[AppGroupSync] failed:', error?.message ?? error);
    });
  };

  import('app-group-store')
    .then((store) => store.migrateLegacyContainer())
    .catch(() => ({ migrated: false, keys: 0 }))
    .finally(() => pushConfig());

  unsubscribe = useSettingsStore.subscribe((state) => {
    pushConfig(state.config);
  });

  return () => {
    unsubscribe?.();
    unsubscribe = null;
    lastSnapshot = '';
  };
}
