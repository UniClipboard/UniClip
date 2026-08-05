import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Host, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import { useTheme } from '@/hooks/useTheme';
import { CompanionArt } from './onboarding/Illustrations';
import { SpaceSetupResult } from './SpaceSetupResult';
import type { LegacyPairingGuideProps } from './LegacyPairingGuide.types';

export function LegacyPairingGuide({ onComplete }: LegacyPairingGuideProps) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const c = theme.colors;
  const [joinVisible, setJoinVisible] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const completedConnectionRef = useRef(false);

  const closeSheet = () => {
    setJoinVisible(false);
    if (!completedConnectionRef.current) return;
    completedConnectionRef.current = false;
    setShowResult(true);
  };

  if (showResult) return <SpaceSetupResult onEnter={onComplete} />;

  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={s.main}>
        <View style={s.art}>
          <CompanionArt
            accent={c.accent as string}
            line={c.border as string}
            surface={c.surfaceHigh as string}
            bg={c.background as string}
            fg2={c.textSecondary as string}
            width={246}
          />
        </View>
        <Text style={[s.title, { color: c.textPrimary }]}>{t('migration.title')}</Text>
        <Text style={[s.body, { color: c.textSecondary }]}>{t('migration.body')}</Text>
        <Text style={[s.hint, { color: c.textPrimary }]}>{t('migration.desktopHint')}</Text>
      </View>

      <Host style={s.actions} colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={c.accent}>
        <Button onClick={() => setJoinVisible(true)} modifiers={[fillMaxWidth()]}>
          <ComposeText>{t('migration.join')}</ComposeText>
        </Button>
      </Host>

      <AddSyncConnectionSheet
        visible={joinVisible}
        initialMode="join"
        onClose={closeSheet}
        onConnected={() => {
          completedConnectionRef.current = true;
          return true;
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  main: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  art: { minHeight: 158, justifyContent: 'center', marginBottom: 20 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', textAlign: 'center' },
  body: { maxWidth: 340, marginTop: 12, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  hint: {
    maxWidth: 340,
    marginTop: 14,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    textAlign: 'center',
  },
  actions: { width: '100%', height: 56 },
});
