import type { UpdateCheckResult } from '@/features/updates';

export type SettingsSubSection =
  | 'space'
  | 'history'
  | 'background'
  | 'appearance'
  | 'storage'
  | 'about'
  | 'developer';

export type RootStackParamList = {
  Onboarding: undefined;
  Migration: undefined;
  Main: undefined;
  Settings:
    | { section?: 'space'; deviceId?: string; notificationNavigationRequestId?: number }
    | undefined;
  SettingsSub: {
    section: SettingsSubSection;
    update?: UpdateCheckResult;
    deviceId?: string;
    notificationNavigationRequestId?: number;
  };
};
