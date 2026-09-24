import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { HomeView } from '@/screens/HomeView';
import type { UpdateCheckResult } from '@/features/updates';
import type { RootStackParamList } from './AppNavigator.types';

/** iOS 主页面:首页本身,设置由首页入口以 sheet 形式打开。 */
export function MainScreen() {
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
