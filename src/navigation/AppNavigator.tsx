import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  useNavigation,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { navigationRef, flushPendingNavigation } from './navigationRef';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { useSpaceSetupCompletionStore, useUnifiedSpaceStore } from '@/features/space';
import { HomeView } from '@/screens/HomeView';
import { LegacyPairingGuide } from '@/screens/LegacyPairingGuide';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SettingsSubScreen } from '@/screens/settings/SettingsSubScreen';
import type { UpdateCheckResult } from '@/features/updates';
import { capturePostHogScreen } from '@/support/observability';

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

const Stack = createNativeStackNavigator<RootStackParamList>();
type SetupSession = 'onboarding' | 'migration';
const CompleteSetupSessionContext = createContext<() => void>(() => undefined);

function MainScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Main'>>();
  const openSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);
  const openAbout = useCallback(
    (update: UpdateCheckResult) => {
      navigation.navigate('SettingsSub', { section: 'about', update });
    },
    [navigation]
  );
  return <HomeView onOpenSettings={openSettings} onOpenAbout={openAbout} />;
}

function MigrationGuideGate() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Migration'>>();
  const updateConfig = useSettingsStore((s) => s.updateConfig);
  const completeSetupSession = useContext(CompleteSetupSessionContext);
  const onComplete = useCallback(async () => {
    const result = await updateConfig({ legacyPairingGuide: 'none' });
    if (!result.ok) return false;
    completeSetupSession();
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    return true;
  }, [completeSetupSession, navigation, updateConfig]);
  return <LegacyPairingGuide onComplete={onComplete} />;
}

function OnboardingGate() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Onboarding'>>();
  const completeSetupSession = useContext(CompleteSetupSessionContext);
  const onComplete = useCallback(async () => {
    completeSetupSession();
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  }, [completeSetupSession, navigation]);
  return <OnboardingScreen onComplete={onComplete} />;
}

export const AppNavigator = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const config = useSettingsStore((s) => s.config);
  const updateConfig = useSettingsStore((s) => s.updateConfig);
  const spaceStatus = useUnifiedSpaceStore((s) => s.status);
  const completionStatus = useSpaceSetupCompletionStore((s) => s.status);
  const [setupSession, setSetupSession] = useState<SetupSession | null>(null);

  useEffect(() => {
    if (config && spaceStatus === 'ready' && config.legacyPairingGuide === 'pending') {
      void updateConfig({ legacyPairingGuide: 'none' });
    }
  }, [config?.legacyPairingGuide, spaceStatus, updateConfig]);

  const requestedSetup: SetupSession | null =
    config && completionStatus === 'incomplete'
      ? config.legacyPairingGuide === 'pending'
        ? 'migration'
        : 'onboarding'
      : null;

  useEffect(() => {
    if (!setupSession && requestedSetup) setSetupSession(requestedSetup);
  }, [requestedSetup, setupSession]);

  const activeSetup = setupSession ?? requestedSetup;
  const rootMode = activeSetup ?? 'main';
  const initialRouteName =
    rootMode === 'migration' ? 'Migration' : rootMode === 'onboarding' ? 'Onboarding' : 'Main';

  const captureCurrentScreen = useCallback(() => {
    const screenName = (navigationRef.getCurrentRoute() as { name?: string } | undefined)?.name;
    if (screenName) capturePostHogScreen(screenName);
  }, []);

  const handleNavigationReady = useCallback(() => {
    flushPendingNavigation();
    captureCurrentScreen();
  }, [captureCurrentScreen]);

  // 子页面标题在组件内按当前语言构建(而非模块级常量),切换语言即时生效
  const subScreenTitles: Record<SettingsSubSection, string> = {
    space: t('space.title', { ns: 'settingsSync' }),
    history: t('nav.history'),
    background: t('nav.background'),
    appearance: t('nav.appearance'),
    storage: t('nav.storage'),
    about: t('nav.about'),
    developer: t('nav.developer'),
  };

  const navigationTheme = theme.isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: theme.colors.accent as string,
          background: theme.colors.background as string,
          card: theme.colors.surface as string,
          text: theme.colors.textPrimary as string,
          border: theme.colors.separator as string,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          primary: theme.colors.accent as string,
          background: theme.colors.background as string,
          card: theme.colors.surface as string,
          text: theme.colors.textPrimary as string,
          border: theme.colors.separator as string,
        },
      };

  if (!config || completionStatus === 'unknown') {
    return <View style={[styles.loading, { backgroundColor: theme.colors.background }]} />;
  }

  return (
    <CompleteSetupSessionContext.Provider value={() => setSetupSession(null)}>
      <NavigationContainer
        key={rootMode}
        ref={navigationRef}
        theme={navigationTheme}
        onReady={handleNavigationReady}
        onStateChange={captureCurrentScreen}
      >
        <Stack.Navigator initialRouteName={initialRouteName} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Onboarding" component={OnboardingGate} />
          <Stack.Screen name="Migration" component={MigrationGuideGate} />
          <Stack.Screen name="Main" component={MainScreen} />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={
              Platform.OS === 'ios'
                ? {
                    headerShown: false,
                    presentation: 'transparentModal',
                    animation: 'none',
                    contentStyle: { backgroundColor: 'transparent' },
                  }
                : {
                    headerShown: true,
                    title: t('action.settings', { ns: 'common' }),
                    presentation: 'card',
                    animation: 'slide_from_right',
                    headerStyle: {
                      backgroundColor: theme.colors.surface as string,
                    },
                    headerShadowVisible: false,
                    headerTintColor: theme.colors.textPrimary as string,
                  }
            }
          />
          <Stack.Screen
            name="SettingsSub"
            component={SettingsSubScreen}
            options={({ route }) => ({
              headerShown: true,
              title: subScreenTitles[route.params.section],
              presentation: 'card',
              animation: 'slide_from_right',
              headerStyle: {
                backgroundColor: theme.colors.surface as string,
              },
              headerShadowVisible: false,
              headerTintColor: theme.colors.textPrimary as string,
            })}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </CompleteSetupSessionContext.Provider>
  );
};

const styles = StyleSheet.create({
  loading: { flex: 1 },
});
