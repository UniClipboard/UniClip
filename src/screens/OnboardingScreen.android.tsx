import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { useTheme } from '@/hooks/useTheme';
import { BrandMark } from './onboarding/Illustrations';
import { OnboardingPile } from './onboarding/OnboardingPile';
import type { OnboardingScreenProps } from './OnboardingScreen.types';

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const c = theme.colors;
  const [flow, setFlow] = useState<AddSyncConnectionMode | null>(null);

  const finishSetup = async () => {
    await onComplete();
    return true;
  };

  return (
    <SafeAreaView style={[s.root, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <View style={s.brand}>
        <BrandMark color={theme.isDark ? '#F4F2EE' : '#15171C'} size={34} />
        <Text style={[s.wordmark, { color: c.textPrimary }]}>{t('welcome.wordmark')}</Text>
      </View>

      <View style={s.main}>
        <View style={s.art}>
          <OnboardingPile />
        </View>
        <Text style={[s.title, { color: c.textPrimary }]}>{t('setup.title')}</Text>
        <Text style={[s.body, { color: c.textSecondary }]}>{t('setup.body')}</Text>
      </View>

      <View style={s.actions}>
        <Pressable
          style={[s.primary, { backgroundColor: c.accent }]}
          onPress={() => setFlow('create')}
        >
          <Ionicons name="add-circle-outline" size={21} color={c.onAccent as string} />
          <Text style={[s.primaryText, { color: c.onAccent }]}>{t('setup.create')}</Text>
        </Pressable>
        <Pressable style={[s.secondary, { borderColor: c.border }]} onPress={() => setFlow('join')}>
          <Ionicons name="link-outline" size={20} color={c.textPrimary as string} />
          <Text style={[s.secondaryText, { color: c.textPrimary }]}>{t('setup.join')}</Text>
        </Pressable>
        <Pressable style={s.skip} onPress={() => void onComplete()}>
          <Text style={[s.skipText, { color: c.textSecondary }]}>{t('setup.skip')}</Text>
        </Pressable>
      </View>

      <AddSyncConnectionSheet
        visible={flow !== null}
        initialMode={flow ?? 'choose'}
        legacyLanEligible={false}
        onClose={() => setFlow(null)}
        onOpenLegacyLan={() => {}}
        onConnected={finishSetup}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  brand: { height: 64, flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmark: { fontSize: 16, fontWeight: '700' },
  main: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  art: { minHeight: 150, justifyContent: 'center', marginBottom: 18 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', textAlign: 'center' },
  body: { maxWidth: 320, marginTop: 12, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  actions: { gap: 10, paddingBottom: 8 },
  primary: {
    height: 52,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryText: { fontSize: 16, fontWeight: '700' },
  secondary: {
    height: 52,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  secondaryText: { fontSize: 16, fontWeight: '600' },
  skip: { height: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 15, fontWeight: '600' },
});
