import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export const useSettingsScreenOptions = (): NativeStackNavigationOptions => ({
  headerShown: false,
  presentation: 'transparentModal',
  animation: 'none',
  contentStyle: { backgroundColor: 'transparent' },
});
