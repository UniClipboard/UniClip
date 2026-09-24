import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { AnalyticsConsentControl } from '../AnalyticsConsentControl';

/** 隐私:匿名使用数据开关与重置统计身份 */
export function PrivacyPage() {
  const { t } = useTranslation('settings');
  return (
    <IosSheetPage title={t('category.privacy')}>
      <IosSheetForm>
        <AnalyticsConsentControl />
      </IosSheetForm>
    </IosSheetPage>
  );
}
