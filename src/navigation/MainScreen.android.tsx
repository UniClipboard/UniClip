import { useCallback, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  useNavigation,
  type CompositeNavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
  type BottomTabNavigationOptions,
  type BottomTabNavigationProp,
} from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { MainNavigationBar } from '@/components/android/MainNavigationBar';
import { getLayoutMode } from '@/hooks/useLayoutMode';
import { useTheme } from '@/hooks/useTheme';
import { HomeView } from '@/screens/HomeView';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { SettingsSectionPage } from '@/screens/settings/SettingsSubScreen';
import type { UpdateCheckResult } from '@/features/updates';
import type { MainTabParamList, RootStackParamList } from './AppNavigator.types';

const Tab = createBottomTabNavigator<MainTabParamList>();

type ClipboardNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Clipboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

function ClipboardDestination({
  navigationBarShown,
  onImmersiveModeChange,
}: {
  navigationBarShown: boolean;
  onImmersiveModeChange: (immersive: boolean) => void;
}) {
  const navigation = useNavigation<ClipboardNavigation>();
  const insets = useSafeAreaInsets();
  const openSettings = useCallback(() => navigation.navigate('Preferences'), [navigation]);
  const openAbout = useCallback(
    (update: UpdateCheckResult) => navigation.navigate('SettingsSub', { section: 'about', update }),
    [navigation]
  );
  // 底部导航栏显示时已承担系统导航栏 inset;首页内的 FAB / Snackbar / 多选栏不再重复预留。
  const homeInsets = useMemo(
    () => (navigationBarShown ? { ...insets, bottom: 0 } : insets),
    [insets, navigationBarShown]
  );
  return (
    <SafeAreaInsetsContext.Provider value={homeInsets}>
      <HomeView
        onOpenSettings={openSettings}
        onOpenAbout={openAbout}
        onImmersiveModeChange={onImmersiveModeChange}
      />
    </SafeAreaInsetsContext.Provider>
  );
}

function DevicesDestination({ route }: { route: RouteProp<MainTabParamList, 'Devices'> }) {
  return <SettingsSectionPage section="syncChannel" {...route.params} />;
}

/**
 * Android 主页面:顶级目的地 剪贴板 / 设备 / 设置。手机用底部 M3 导航栏,平板(expanded)
 * 改为左侧 navigation rail。首页搜索 / 多选时隐藏底部导航栏,把底部让给键盘与多选操作栏。
 * 设置二级页仍 push 到根 Stack,覆盖整个主页面。
 */
export function MainScreen() {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const useRail = getLayoutMode(width) === 'expanded';
  const [homeImmersive, setHomeImmersive] = useState(false);
  const navigationBarShown = !useRail && !homeImmersive;

  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => <MainNavigationBar {...props} hidden={homeImmersive} />,
    [homeImmersive]
  );

  const screenOptions = useMemo<BottomTabNavigationOptions>(
    () => ({
      tabBarPosition: useRail ? 'left' : 'bottom',
      headerShown: false,
      sceneStyle: { backgroundColor: theme.colors.background as string },
      headerStyle: { backgroundColor: theme.colors.background as string },
      headerShadowVisible: false,
      headerTintColor: theme.colors.textPrimary as string,
    }),
    [theme.colors.background, theme.colors.textPrimary, useRail]
  );

  return (
    <Tab.Navigator tabBar={renderTabBar} screenOptions={screenOptions}>
      <Tab.Screen name="Clipboard" options={{ title: t('nav.clipboard') }}>
        {() => (
          <ClipboardDestination
            navigationBarShown={navigationBarShown}
            onImmersiveModeChange={setHomeImmersive}
          />
        )}
      </Tab.Screen>
      <Tab.Screen
        name="Devices"
        component={DevicesDestination}
        options={{ title: t('nav.devices'), headerShown: true }}
      />
      <Tab.Screen
        name="Preferences"
        component={SettingsScreen}
        options={{ title: t('nav.settings'), headerShown: true }}
      />
    </Tab.Navigator>
  );
}
