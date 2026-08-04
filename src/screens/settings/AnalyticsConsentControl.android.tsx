import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import {
  HorizontalDivider,
  ListItem,
  Switch as ComposeSwitch,
  Text as ComposeText,
  TextButton,
} from '@expo/ui/jetpack-compose';
import { useTranslation } from 'react-i18next';

import {
  getAnalyticsConsent,
  resetAnalyticsIdentity,
  setAnalyticsConsent,
} from '@/features/settings';
import { SettingsSectionItem } from './SettingsSectionItem';
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
    <SettingsSectionItem title={t('analytics.sectionTitle')} footer={t('analytics.footer')}>
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('analytics.consentTitle')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>{t('analytics.consentDescription')}</ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <ComposeSwitch
            value={enabled ?? false}
            enabled={enabled !== null && !busy}
            onCheckedChange={(value) => void updateConsent(value)}
          />
        </ListItem.TrailingContent>
      </ListItem>
      <HorizontalDivider />
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('analytics.resetTitle')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <TextButton onClick={confirmReset} enabled={!busy}>
            <ComposeText>{t('analytics.reset')}</ComposeText>
          </TextButton>
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
}
