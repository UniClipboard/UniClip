import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Host } from '@expo/ui/jetpack-compose';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import { AppButton } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { SyncUpgradeArt } from './onboarding/Illustrations';
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
          <SyncUpgradeArt
            accent={c.accent as string}
            line={c.separator as string}
            surface={c.surfaceHigh as string}
            bg={c.background as string}
            fg2={c.textSecondary as string}
            width={286}
          />
        </View>
        <Text style={[s.title, { color: c.textPrimary }]}>{t('migration.title')}</Text>
        <Text style={[s.body, { color: c.textSecondary }]}>{t('migration.body')}</Text>
        <View style={[s.reassurance, { backgroundColor: c.accentContainer }]}>
          <Ionicons name="checkmark-circle" size={22} color={c.onAccentContainer as string} />
          <Text style={[s.reassuranceText, { color: c.onAccentContainer }]}>
            {t('migration.historyKept')}
          </Text>
        </View>
        <Text style={[s.reason, { color: c.textSecondary }]}>{t('migration.repairReason')}</Text>
        <Text style={[s.hint, { color: c.textPrimary }]}>{t('migration.desktopHint')}</Text>
      </View>

      <Host style={s.actions} colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={c.accent}>
        <AppButton title={t('migration.join')} onPress={() => setJoinVisible(true)} fullWidth />
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
  art: { minHeight: 158, justifyContent: 'center', marginBottom: 18 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', textAlign: 'center' },
  body: { maxWidth: 340, marginTop: 12, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  reassurance: {
    width: '100%',
    maxWidth: 340,
    minHeight: 48,
    marginTop: 20,
    borderRadius: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  reassuranceText: { fontSize: 15, lineHeight: 21, fontWeight: '600', flexShrink: 1 },
  reason: { maxWidth: 340, marginTop: 18, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  hint: {
    maxWidth: 340,
    marginTop: 8,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
    textAlign: 'center',
  },
  actions: { width: '100%', height: 56 },
});
