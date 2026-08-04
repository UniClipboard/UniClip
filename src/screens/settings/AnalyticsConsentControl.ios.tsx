import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Button, HStack, Section, Spacer, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { disabled, frame } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import {
  getAnalyticsConsent,
  resetAnalyticsIdentity,
  setAnalyticsConsent,
} from '@/features/settings';
import { SettingsIconTile, SettingsToggle, settingsTileColors } from './ios/common';
import type { AnalyticsConsentControlProps } from './AnalyticsConsentControl.types';

export function AnalyticsConsentControl(_: AnalyticsConsentControlProps) {
  const { t } = useTranslation('settings');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getAnalyticsConsent()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        if (active) Alert.alert(t('analytics.error'));
      });
    return () => {
      active = false;
    };
  }, [t]);

  const updateConsent = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setBusy(true);
    try {
      await setAnalyticsConsent(next);
    } catch {
      setEnabled(previous);
      Alert.alert(t('analytics.error'));
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = () => {
    Alert.alert(t('analytics.resetTitle'), t('analytics.resetMessage'), [
      { text: t('action.cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: t('analytics.resetConfirm'),
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void resetAnalyticsIdentity()
            .then(() => Alert.alert(t('analytics.resetDone')))
            .catch(() => Alert.alert(t('analytics.error')))
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <Section
      header={<SwiftUIText>{t('analytics.sectionTitle')}</SwiftUIText>}
      footer={<SwiftUIText>{t('analytics.footer')}</SwiftUIText>}
    >
      <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
        <SettingsIconTile systemName="chart.bar" color={settingsTileColors.blue} />
        <SettingsToggle
          label={t('analytics.consentTitle')}
          isOn={enabled ?? false}
          onIsOnChange={(value) => void updateConsent(value)}
          modifiers={[disabled(enabled === null || busy)]}
        />
      </HStack>
      <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
        <SettingsIconTile systemName="arrow.counterclockwise" color={settingsTileColors.orange} />
        <SwiftUIText>{t('analytics.resetTitle')}</SwiftUIText>
        <Spacer />
        <Button
          label={t('analytics.reset')}
          role="destructive"
          onPress={confirmReset}
          modifiers={[disabled(busy)]}
        />
      </HStack>
    </Section>
  );
}
