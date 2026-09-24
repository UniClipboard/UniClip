import type { NavigatorScreenParams } from '@react-navigation/native';
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

/** Target of a notification or deep link that opens one space device (or the device list). */
export type SpaceDeviceTarget = {
  deviceId?: string;
  notificationNavigationRequestId?: number;
};

/** Android top-level destinations hosted by the Main bottom navigation. */
export type MainTabParamList = {
  Clipboard: undefined;
  Devices: SpaceDeviceTarget | undefined;
  Preferences: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  OnboardingPreview: undefined;
  ConnectionPreview: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
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
