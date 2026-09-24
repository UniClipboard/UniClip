import { useCallback, useMemo, useState } from 'react';
import { useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
  type BottomTabNavigationOptions,
  type BottomTabNavigationProp,
} from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { MainTabBar } from '@/components/ios/MainTabBar';
import { useTheme } from '@/hooks/useTheme';
import { HomeView } from '@/screens/HomeView';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { DevicesScreen } from '@/screens/ios/DevicesScreen';
import type { MainTabParamList, RootStackParamList } from './AppNavigator.types';

const Tab = createBottomTabNavigator<MainTabParamList>();

type ClipboardNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Clipboard'>,
  NativeStackNavigationProp<RootStackParamList>
>;

function ClipboardDestination({
  searchRequestId,
  onImmersiveModeChange,
}: {
  searchRequestId: number;
  onImmersiveModeChange: (immersive: boolean) => void;
}) {
  const navigation = useNavigation<ClipboardNavigation>();
  const openSettings = useCallback(() => navigation.navigate('Preferences'), [navigation]);
  const openAbout = useCallback(() => navigation.navigate('Preferences'), [navigation]);
  return (
    <HomeView
      onOpenSettings={openSettings}
      onOpenAbout={openAbout}
      onImmersiveModeChange={onImmersiveModeChange}
      searchRequestId={searchRequestId}
    />
  );
}

/**
 * iOS 主页面:顶级目的地 剪贴板 / 设备 / 设置,底部是 Liquid Glass 标签胶囊 + 独立搜索圆钮。
 * 搜索只作用于剪贴板历史:在其他标签点搜索会先回到剪贴板再进入搜索。首页搜索 / 多选时
 * 收起标签栏,底部让给搜索框与多选操作栏。
 */
export function MainScreen() {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const [homeImmersive, setHomeImmersive] = useState(false);
  const [searchRequestId, setSearchRequestId] = useState(0);

  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => (
      <MainTabBar
        {...props}
        hidden={homeImmersive}
        onSearch={() => {
          props.navigation.navigate('Clipboard');
          setSearchRequestId((id) => id + 1);
        }}
      />
    ),
    [homeImmersive]
  );

  const screenOptions = useMemo<BottomTabNavigationOptions>(
    () => ({
      headerShown: false,
      sceneStyle: { backgroundColor: theme.colors.background as string },
    }),
    [theme.colors.background]
  );

  return (
    <Tab.Navigator tabBar={renderTabBar} screenOptions={screenOptions}>
      <Tab.Screen name="Clipboard" options={{ title: t('nav.clipboard') }}>
        {() => (
          <ClipboardDestination
            searchRequestId={searchRequestId}
            onImmersiveModeChange={setHomeImmersive}
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Devices" options={{ title: t('nav.devices') }}>
        {({ route }) => <DevicesScreen {...route.params} />}
      </Tab.Screen>
      <Tab.Screen name="Preferences" options={{ title: t('nav.settings') }}>
        {() => <SettingsScreen />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
