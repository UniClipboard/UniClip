import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Host } from '@expo/ui/swift-ui';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import { iosProminentButtonModifiers } from '@/components/ui/iosButtonStyles.ios';
import { useTheme } from '@/hooks/useTheme';
import { iosAccent, iosOnAccent } from '@/theme/iosDesignTokens';
import { CompanionArt } from './onboarding/Illustrations';
import { SpaceSetupResult } from './SpaceSetupResult';
import type { LegacyPairingGuideProps } from './LegacyPairingGuide.types';

export function LegacyPairingGuide({ onComplete }: LegacyPairingGuideProps) {
  const { t } = useTranslation('onboarding');
  const { theme } = useTheme();
  const ink = theme.isDark ? iosAccent.dark : iosAccent.light;
  const onInk = theme.isDark ? iosOnAccent.dark : iosOnAccent.light;
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
    <SafeAreaView
      style={[s.root, { backgroundColor: theme.colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={s.main}>
        <View style={s.art}>
          <CompanionArt
            accent={ink}
            line={theme.colors.separator as string}
            surface={theme.colors.surface as string}
            bg={theme.colors.background as string}
            fg2={theme.colors.textSecondary as string}
            width={246}
          />
        </View>
        <Text style={[s.title, { color: theme.colors.textPrimary }]}>{t('migration.title')}</Text>
        <Text style={[s.body, { color: theme.colors.textSecondary }]}>{t('migration.body')}</Text>
        <Text style={[s.hint, { color: theme.colors.textPrimary }]}>
          {t('migration.desktopHint')}
        </Text>
      </View>

      <Host style={s.actions}>
        <Button
          label={t('migration.join')}
          onPress={() => setJoinVisible(true)}
          modifiers={iosProminentButtonModifiers(
            { background: ink, foreground: onInk },
            { fullWidth: true }
          )}
        />
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
  title: { fontSize: 29, lineHeight: 35, fontWeight: '700', textAlign: 'center' },
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
