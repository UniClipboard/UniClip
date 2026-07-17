import type { AppConfig } from '@/types/storage';

type DirectionConfig = Pick<
  AppConfig,
  | 'autoApplyRemote'
  | 'autoPushLocal'
  | 'enableBackgroundTasks'
  | 'enableBackgroundDownload'
  | 'enableBackgroundUpload'
>;

type MaybeDirectionConfig = Partial<DirectionConfig> | null | undefined;

export function canAutoApplyInBackground(
  config: MaybeDirectionConfig,
  temporarilyDisabled = false
): boolean {
  return Boolean(
    !temporarilyDisabled &&
    (config?.autoApplyRemote ?? true) &&
    config?.enableBackgroundTasks &&
    config.enableBackgroundDownload
  );
}

export function canAutoPushInBackground(
  config: MaybeDirectionConfig,
  temporarilyDisabled = false
): boolean {
  return Boolean(
    !temporarilyDisabled &&
    (config?.autoPushLocal ?? true) &&
    config?.enableBackgroundTasks &&
    config.enableBackgroundUpload
  );
}

export function shouldRunBackgroundSync(
  config: MaybeDirectionConfig,
  temporarilyDisabled: boolean
): boolean {
  return (
    canAutoApplyInBackground(config, temporarilyDisabled) ||
    canAutoPushInBackground(config, temporarilyDisabled)
  );
}
