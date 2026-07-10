import React, { useCallback } from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  useNavigation,
} from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { navigationRef, flushPendingNavigation } from './navigationRef';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { HomeView } from '@/screens/HomeView';
import { OnboardingScreen } from '@/screens/OnboardingScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SettingsSubScreen } from '@/screens/settings/SettingsSubScreen';

export type SettingsSubSection =
  | 'sync'
  | 'history'
  | 'background'
  | 'appearance'
  | 'sms'
  | 'storage'
  | 'about'
  | 'developer';

export type RootStackParamList = {
  Onboarding: undefined;
  Main: undefined;
  Settings: undefined;
  SettingsSub: { section: SettingsSubSection };
};

const Stack = createStackNavigator<RootStackParamList>();

function MainScreen() {
  const navigation = useNavigation<any>();
  const openSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);
  return <HomeView onOpenSettings={openSettings} />;
}

/**
 * 首启引导容器:落库 onboardingCompleted,再把用户送到 Main。
 * 扫码成功(paired)时凭据已由 QrScannerModal 写入 pendingConnectStore,HomeView 挂载后
 * 自行消费并弹出预填「添加服务器」表单——无需再中转整个 Settings 面板(那会多叠一层 sheet)。
 * 暂不配对 → 同样进 Main,无 pendingConnect 即不弹表单。
 */
function OnboardingGate() {
  const navigation = useNavigation<any>();
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

  // 首启引导:仅对「未完成引导且尚无任何服务器」的全新安装展示;
  // 既有用户(已配置 server)自动跳过,无需 schema 迁移。
  const showOnboarding =
    !!config && !config.onboardingCompleted && (config.servers?.length ?? 0) === 0;

  // 子页面标题在组件内按当前语言构建(而非模块级常量),切换语言即时生效
  const subScreenTitles: Record<SettingsSubSection, string> = {
    sync: t('nav.sync'),
    history: t('nav.history'),
    background: t('nav.background'),
    appearance: t('nav.appearance'),
    sms: t('nav.sms'),
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
                  cardStyle: { backgroundColor: 'transparent' },
                }
              : {
                  headerShown: true,
                  title: t('action.settings', { ns: 'common' }),
                  presentation: 'card',
                  headerStyle: {
                    backgroundColor: theme.colors.surface as string,
                    elevation: 0,
                    shadowOpacity: 0,
                  },
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
            headerStyle: {
              backgroundColor: theme.colors.surface as string,
              elevation: 0,
              shadowOpacity: 0,
            },
            headerTintColor: theme.colors.textPrimary as string,
          })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
