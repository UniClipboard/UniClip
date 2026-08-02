import React, { useCallback, useEffect } from 'react';
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
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { navigationRef, flushPendingNavigation } from './navigationRef';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { useUnifiedSpaceStore } from '@/stores/unifiedSpaceStore';
import { HomeView } from '@/screens/HomeView';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SettingsSubScreen } from '@/screens/settings/SettingsSubScreen';
import type { UpdateCheckResult } from '@/services/UpdateService';

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
  Main: undefined;
  Settings: undefined;
  SettingsSub: { section: SettingsSubSection; update?: UpdateCheckResult };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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

/** 首启引导容器:落库 onboardingCompleted,再把用户送到 Main。 */
function OnboardingGate() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Onboarding'>>();
  const updateConfig = useSettingsStore((s) => s.updateConfig);
  const onComplete = useCallback(async () => {
    await updateConfig({ onboardingCompleted: true });
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  }, [navigation, updateConfig]);
  return <OnboardingScreen onComplete={onComplete} />;
}

export const AppNavigator = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('home');
  const config = useSettingsStore((s) => s.config);
  const updateConfig = useSettingsStore((s) => s.updateConfig);
  const spaceStatus = useUnifiedSpaceStore((s) => s.status);

  useEffect(() => {
    if (spaceStatus === 'empty' && config?.onboardingCompleted) {
      void updateConfig({ onboardingCompleted: false });
    }
  }, [config?.onboardingCompleted, spaceStatus, updateConfig]);

  const showOnboarding = !!config && (!config.onboardingCompleted || spaceStatus === 'empty');

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

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={flushPendingNavigation}
    >
      <Stack.Navigator
        key={showOnboarding ? 'onboarding' : 'main'}
        initialRouteName={showOnboarding ? 'Onboarding' : 'Main'}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Onboarding" component={OnboardingGate} />
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
  );
};
