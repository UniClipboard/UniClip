import React, { useCallback } from 'react';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  useNavigation,
} from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Platform } from 'react-native';
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

const SUB_SCREEN_TITLES: Record<SettingsSubSection, string> = {
  sync: '服务器与同步',
  history: '历史记录',
  background: '后台运行',
  appearance: '外观',
  sms: '短信转发',
  storage: '存储',
  about: '关于',
  developer: '开发者选项',
};

function MainScreen() {
  const navigation = useNavigation<any>();
  const openSettings = useCallback(() => {
    navigation.navigate('Settings');
  }, [navigation]);
  return <HomeView onOpenSettings={openSettings} />;
}

export const AppNavigator = () => {
  const { theme } = useTheme();

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
                  title: '设置',
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
            title: SUB_SCREEN_TITLES[route.params.section],
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
