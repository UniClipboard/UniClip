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
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { navigationRef, flushPendingNavigation } from './navigationRef';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { HomeView } from '@/screens/HomeView';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { OnboardingPreviewScreen } from '@/screens/OnboardingPreviewScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SettingsSubScreen } from '@/screens/settings/SettingsSubScreen';
import type { UpdateCheckResult } from '@/features/updates';
import { capturePostHogScreen } from '@/support/observability';
import type { RootStackParamList, SettingsSubSection } from './AppNavigator.types';
import { useSettingsScreenOptions } from './useSettingsScreenOptions';

export type { RootStackParamList, SettingsSubSection } from './AppNavigator.types';

const Stack = createNativeStackNavigator<RootStackParamList>();
type SetupSession = 'onboarding';
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

function OnboardingGate() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Onboarding'>>();
  const completeSetupSession = useContext(CompleteSetupSessionContext);
  const onComplete = useCallback(async () => {
    const result = await useSettingsStore.getState().updateConfig({ welcomeCompleted: true });
    if (!result.ok) throw new Error(result.error || 'Failed to save welcome completion');
    completeSetupSession();
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  }, [completeSetupSession, navigation]);
  return <OnboardingScreen onComplete={onComplete} />;
}

export const AppNavigator = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const settingsOptions = useSettingsScreenOptions();
  const config = useSettingsStore((s) => s.config);
  // Resolve the entry once; changing sync settings must not replace an active navigator.
  const [setupSession, setSetupSession] = useState<SetupSession | null | undefined>(undefined);
  const waitingForStartup = !config;

  const requestedSetup: SetupSession | null =
    config && !config.welcomeCompleted ? 'onboarding' : null;

  useEffect(() => {
    if (setupSession === undefined && !waitingForStartup) setSetupSession(requestedSetup);
  }, [requestedSetup, setupSession, waitingForStartup]);

  const activeSetup = setupSession === undefined ? requestedSetup : setupSession;
  const rootMode = activeSetup ?? 'main';
  const initialRouteName = rootMode === 'onboarding' ? 'Onboarding' : 'Main';

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
    syncChannel: t('syncChannel.title', { ns: 'settings' }),
    space: t('space.title', { ns: 'settingsSync' }),
    lanServers: t('lan.title', { ns: 'settingsSync' }),
    history: t('category.history', { ns: 'settings' }),
    background: t('category.background', { ns: 'settings' }),
    appearance: t('appearance.sectionTitle', { ns: 'settings' }),
    storage: t('category.storage', { ns: 'settings' }),
    about: t('category.about', { ns: 'settings' }),
    developer: t('category.developer', { ns: 'settings' }),
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

  if (setupSession === undefined && waitingForStartup) {
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
          <Stack.Screen
            name="OnboardingPreview"
            component={OnboardingPreviewScreen}
            options={{ presentation: 'fullScreenModal' }}
          />
          <Stack.Screen name="Main" component={MainScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={settingsOptions} />
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
