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
import { navigationRef } from './navigationRef';
import { useTheme } from '@/hooks/useTheme';
import { HomeView } from '@/screens/HomeView';
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

export const AppNavigator = () => {
  const { theme } = useTheme();
  const { t } = useTranslation('home');

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
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
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
