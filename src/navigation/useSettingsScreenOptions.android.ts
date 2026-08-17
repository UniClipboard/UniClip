import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';

export const useSettingsScreenOptions = (): NativeStackNavigationOptions => {
  const { theme } = useTheme();
  const { t } = useTranslation('home');

  return {
    headerShown: true,
    title: t('action.settings', { ns: 'common' }),
    presentation: 'card',
    animation: 'slide_from_right',
    headerStyle: { backgroundColor: theme.colors.surface as string },
    headerShadowVisible: false,
    headerTintColor: theme.colors.textPrimary as string,
  };
};
