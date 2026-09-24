/**
 * 隐私二级页(Android):匿名统计开关 + 重置统计身份,grouped 分组。
 * 两行都是整行交互:开关行 toggleable,重置行整行点击弹出确认。
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getAnalyticsConsent,
  resetAnalyticsIdentity,
  setAnalyticsConsent,
} from '@/features/settings';
import { AppAlertDialog } from '@/components/ui/AppAlertDialog';
import { SettingsSectionItem } from './SettingsSectionItem';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsListRow } from './android/SettingsListRow';
import { SettingsSwitchRow } from './android/SettingsSwitchRow';
import type { AnalyticsConsentControlProps } from './AnalyticsConsentControl.types';

export function AnalyticsConsentControl(_: AnalyticsConsentControlProps) {
  const { t } = useTranslation('settings');
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
      variant="grouped"
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
        key="consent"
        testID="analytics-consent"
        title={t('analytics.consentTitle')}
        description={t('analytics.consentDescription')}
        value={enabled ?? false}
        disabled={enabled === null || busy}
        onValueChange={(value) => void updateConsent(value)}
      />
      <SettingsListRow
        key="reset"
        testID="analytics-reset"
        title={t('analytics.resetTitle')}
        description={t('analytics.resetMessage')}
        disabled={busy}
        onPress={() => setResetDialogOpen(true)}
      />
    </SettingsSectionItem>
  );
}
