import { useEffect, useState } from 'react';
import {
  HorizontalDivider,
  Icon,
  ListItem,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import {
  getAnalyticsConsent,
  resetAnalyticsIdentity,
  setAnalyticsConsent,
} from '@/features/settings';
import { AppAlertDialog } from '@/components/ui/AppAlertDialog';
import { SettingsSectionItem } from './SettingsSectionItem';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSwitchRow } from './android/SettingsSwitchRow';
import type { AnalyticsConsentControlProps } from './AnalyticsConsentControl.types';

const ICONS = {
  analytics: require('../../assets/icons/analytics.xml'),
  reset: require('../../assets/icons/restart_alt.xml'),
};

export function AnalyticsConsentControl(_: AnalyticsConsentControlProps) {
  const { t } = useTranslation('settings');
  const colors = useMaterialColors();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const showMessage = useSettingsToast();

  useEffect(() => {
    let active = true;
    void getAnalyticsConsent()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        if (active) showMessage(t('analytics.error'), 'error');
      });
    return () => {
      active = false;
    };
  }, [t, showMessage]);

  const updateConsent = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setBusy(true);
    try {
      await setAnalyticsConsent(next);
    } catch {
      setEnabled(previous);
      showMessage(t('analytics.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // 重置身份不可撤销,保留确认,但用 Compose M3 AlertDialog 而非旧式系统弹窗;结果走 Snackbar
  const performReset = () => {
    setResetDialogOpen(false);
    setBusy(true);
    void resetAnalyticsIdentity()
      .then(() => showMessage(t('analytics.resetDone'), 'success'))
      .catch(() => showMessage(t('analytics.error'), 'error'))
      .finally(() => setBusy(false));
  };

  return (
    <SettingsSectionItem
      title={t('analytics.sectionTitle')}
      footer={t('analytics.footer')}
      dialogs={
        <AppAlertDialog
          visible={resetDialogOpen}
          onDismiss={() => setResetDialogOpen(false)}
          title={t('analytics.resetTitle')}
          message={t('analytics.resetMessage')}
          confirmLabel={t('analytics.resetConfirm')}
          onConfirm={performReset}
          dismissLabel={t('action.cancel', { ns: 'common' })}
        />
      }
    >
      <SettingsSwitchRow
        title={t('analytics.consentTitle')}
        description={t('analytics.consentDescription')}
        leading={<Icon source={ICONS.analytics} size={22} tint={colors.onSurfaceVariant} />}
        value={enabled ?? false}
        disabled={enabled === null || busy}
        onValueChange={(value) => void updateConsent(value)}
      />
      <HorizontalDivider />
      {/* 整行可点(全行交互规范),不再只让尾部 TextButton 可点 */}
      <ListItem modifiers={busy ? undefined : [clickable(() => setResetDialogOpen(true))]}>
        <ListItem.LeadingContent>
          <Icon source={ICONS.reset} size={22} tint={colors.onSurfaceVariant} />
        </ListItem.LeadingContent>
        <ListItem.HeadlineContent>
          <ComposeText>{t('analytics.resetTitle')}</ComposeText>
        </ListItem.HeadlineContent>
      </ListItem>
    </SettingsSectionItem>
  );
}
