import { Platform } from 'react-native';
import { saveSettings } from 'app-group-store';
import type { AppSettings } from '@/types/settings';

export interface AppGroupSettingsDTO {
  autoApplyRemoteChanges?: boolean;
  autoPushDeviceChanges?: boolean;
  prefetchAttachments?: boolean;
  prefetchOnCellular?: boolean;
  payloadCacheMaxBytes?: number;
  appearance?: 'system' | 'light' | 'dark';
  language?: string;
  autoCheckUpdate?: boolean;
  ignoredVersion?: string | null;
  downloadRelativePath?: string;
  logViewLevelFilter?: string;
  keyboardSoundFeedback?: boolean;
  keyboardHapticFeedback?: boolean;
}

export function mapSettingsToAppGroupDTO(settings: AppSettings): AppGroupSettingsDTO {
  const prefetch = mapAttachmentPrefetch(settings.attachmentAutoDownload);

  return {
    autoApplyRemoteChanges: settings.autoApplyRemote,
    autoPushDeviceChanges: settings.autoPushLocal,
    prefetchAttachments: prefetch.attachments,
    prefetchOnCellular: prefetch.cellular,
    payloadCacheMaxBytes: settings.payloadCacheMaxBytes,
    appearance: settings.appearance,
    language: settings.language,
    autoCheckUpdate: settings.autoCheckUpdate,
    ignoredVersion: settings.ignoredVersion,
    downloadRelativePath: settings.downloadRelativePath,
    logViewLevelFilter: settings.logLevel,
    keyboardSoundFeedback: settings.keyboardSoundFeedback,
    keyboardHapticFeedback: settings.keyboardHapticFeedback,
  };
}

export function getAppGroupSyncSnapshot(config: AppSettings | null): string | null {
  if (!config) return null;
  return JSON.stringify(mapSettingsToAppGroupDTO(config));
}

export async function syncConfigToAppGroup(config: AppSettings | null): Promise<void> {
  if (Platform.OS !== 'ios' || !config) return;

  await saveSettings(mapSettingsToAppGroupDTO(config));
}

function mapAttachmentPrefetch(value: AppSettings['attachmentAutoDownload']): {
  attachments: boolean;
  cellular: boolean;
} {
  switch (value) {
    case 'always':
      return { attachments: true, cellular: true };
    case 'wifi':
      return { attachments: true, cellular: false };
    case 'off':
      return { attachments: false, cellular: false };
  }
}
