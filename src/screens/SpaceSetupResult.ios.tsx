import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Host } from '@expo/ui/swift-ui';
import { disabled } from '@expo/ui/swift-ui/modifiers';
import { CircleCheckBig } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { iosProminentButtonModifiers } from '@/components/ui/iosButtonStyles.ios';
import { useTheme } from '@/hooks/useTheme';
import { iosAccent, iosOnAccent } from '@/theme/iosDesignTokens';
import type { SpaceSetupResultProps } from './SpaceSetupResult.types';

export function SpaceSetupResult({ onEnter }: SpaceSetupResultProps) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const [pending, setPending] = useState(false);
  const ink = theme.isDark ? iosAccent.dark : iosAccent.light;
  const onInk = theme.isDark ? iosOnAccent.dark : iosOnAccent.light;

  const enter = async () => {
    if (pending) return;
    setPending(true);
    if ((await onEnter()) === false) setPending(false);
  };

  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: theme.colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={s.main}>
        <CircleCheckBig size={88} color={ink} strokeWidth={1.7} />
        <Text style={[s.title, { color: theme.colors.textPrimary }]}>{t('result.title')}</Text>
        <Text style={[s.body, { color: theme.colors.textSecondary }]}>{t('result.body')}</Text>
      </View>
      <Host style={s.actions}>
        <Button
          label={t('result.enter')}
          onPress={() => void enter()}
          modifiers={[
            ...iosProminentButtonModifiers(
              { background: ink, foreground: onInk },
              { fullWidth: true }
            ),
            disabled(pending),
          ]}
        />
      </Host>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  main: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 24, fontSize: 29, lineHeight: 35, fontWeight: '700', textAlign: 'center' },
  body: { maxWidth: 340, marginTop: 12, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  actions: { width: '100%', height: 56 },
});
