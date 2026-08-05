import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Host, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/useTheme';
import type { SpaceSetupResultProps } from './SpaceSetupResult.types';

export function SpaceSetupResult({ onEnter }: SpaceSetupResultProps) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const [pending, setPending] = useState(false);
  const c = theme.colors;

  const enter = async () => {
    if (pending) return;
    setPending(true);
    if ((await onEnter()) === false) setPending(false);
  };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={s.main}>
        <Ionicons name="checkmark-circle" size={88} color={c.accent as string} />
        <Text style={[s.title, { color: c.textPrimary }]}>{t('result.title')}</Text>
        <Text style={[s.body, { color: c.textSecondary }]}>{t('result.body')}</Text>
      </View>
      <Host style={s.actions} colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={c.accent}>
        <Button onClick={() => void enter()} enabled={!pending} modifiers={[fillMaxWidth()]}>
          <ComposeText>{t('result.enter')}</ComposeText>
        </Button>
      </Host>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  main: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 24, fontSize: 28, lineHeight: 34, fontWeight: '700', textAlign: 'center' },
  body: { maxWidth: 340, marginTop: 12, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  actions: { width: '100%', height: 56 },
});
