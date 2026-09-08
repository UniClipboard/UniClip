import type { UpdateCheckResult } from '@/features/updates';

export type SettingsSubSection =
  | 'syncChannel'
  | 'space'
  | 'lanServers'
  | 'history'
  | 'background'
  | 'appearance'
  | 'storage'
  | 'about'
  | 'developer';

export type RootStackParamList = {
  Onboarding: undefined;
  OnboardingPreview: undefined;
  ConnectionPreview: undefined;
  Main: undefined;
  Settings:
    | {
        section?: 'space' | 'lanServers';
        deviceId?: string;
        notificationNavigationRequestId?: number;
      }
    | undefined;
  SettingsSub: {
    section: SettingsSubSection;
    update?: UpdateCheckResult;
    deviceId?: string;
    notificationNavigationRequestId?: number;
  };
};
