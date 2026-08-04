import { Platform } from 'react-native';
import { getSettings } from 'app-group-store';
import type { AppSettings } from '@/types/settings';

const LOG_LEVELS: AppSettings['logLevel'][] = ['debug', 'info', 'warn', 'error'];

export async function seedConfigFromAppGroup(): Promise<Partial<AppSettings> | null> {
  if (Platform.OS !== 'ios') return null;

  const settings = await getSettings();
  const partial: Partial<AppSettings> = {};

  if (settings.autoApplyRemoteChanges !== undefined) {
    partial.autoApplyRemote = settings.autoApplyRemoteChanges;
  }
  if (settings.autoPushDeviceChanges !== undefined) {
    partial.autoPushLocal = settings.autoPushDeviceChanges;
  }
  if (settings.payloadCacheMaxBytes !== undefined) {
    partial.payloadCacheMaxBytes = settings.payloadCacheMaxBytes;
  }
  if (settings.appearance !== undefined) {
    partial.appearance = settings.appearance;
  }
  if (settings.language !== undefined) {
    partial.language = settings.language;
  }
  if (settings.autoCheckUpdate !== undefined) {
    partial.autoCheckUpdate = settings.autoCheckUpdate;
  }
  if (settings.ignoredVersion !== undefined) {
    partial.ignoredVersion = settings.ignoredVersion;
  }
  if (settings.downloadRelativePath !== undefined) {
    partial.downloadRelativePath = settings.downloadRelativePath;
  }
  if (settings.prefetchAttachments !== undefined) {
    partial.attachmentAutoDownload = settings.prefetchAttachments
      ? settings.prefetchOnCellular
        ? 'always'
        : 'wifi'
      : 'off';
  }
  if (settings.logViewLevelFilter && isLogLevel(settings.logViewLevelFilter)) {
    partial.logLevel = settings.logViewLevelFilter;
  }
  if (settings.keyboardSoundFeedback !== undefined) {
    partial.keyboardSoundFeedback = settings.keyboardSoundFeedback;
  }
  if (settings.keyboardHapticFeedback !== undefined) {
    partial.keyboardHapticFeedback = settings.keyboardHapticFeedback;
  }

  return Object.keys(partial).length > 0 ? partial : null;
}

function isLogLevel(value: string): value is AppSettings['logLevel'] {
  return LOG_LEVELS.includes(value as AppSettings['logLevel']);
}
