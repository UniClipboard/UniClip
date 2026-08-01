import type { AppConfig } from '@/types/storage';
import type { NetworkContext } from '@/services/networkContext';

type DirectionConfig = Pick<
  AppConfig,
  | 'autoApplyRemote'
  | 'autoPushLocal'
  | 'enableBackgroundTasks'
  | 'enableBackgroundDownload'
  | 'enableBackgroundUpload'
  | 'backgroundSyncNetwork'
>;

type MaybeDirectionConfig = Partial<DirectionConfig> | null | undefined;

function allowsBackgroundNetwork(
  config: MaybeDirectionConfig,
  network?: Pick<NetworkContext, 'isWifi'>
): boolean {
  return config?.backgroundSyncNetwork !== 'wifi' || network?.isWifi === true;
}

export function canAutoApplyInBackground(
  config: MaybeDirectionConfig,
  temporarilyDisabled = false,
  network?: Pick<NetworkContext, 'isWifi'>
): boolean {
  return Boolean(
    !temporarilyDisabled &&
      allowsBackgroundNetwork(config, network) &&
      (config?.autoApplyRemote ?? true) &&
      config?.enableBackgroundTasks &&
      config.enableBackgroundDownload
  );
}

export function canAutoPushInBackground(
  config: MaybeDirectionConfig,
  temporarilyDisabled = false,
  network?: Pick<NetworkContext, 'isWifi'>
): boolean {
  return Boolean(
    !temporarilyDisabled &&
      allowsBackgroundNetwork(config, network) &&
      (config?.autoPushLocal ?? true) &&
      config?.enableBackgroundTasks &&
      config.enableBackgroundUpload
  );
}

export function shouldRunBackgroundSync(
  config: MaybeDirectionConfig,
  temporarilyDisabled: boolean,
  network?: Pick<NetworkContext, 'isWifi'>
): boolean {
  return (
    canAutoApplyInBackground(config, temporarilyDisabled, network) ||
    canAutoPushInBackground(config, temporarilyDisabled, network)
  );
}
