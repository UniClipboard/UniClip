import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { getUnifiedContentService } from '@/services/UnifiedContentService';
import { persistP2pDeliveryReport } from '@/services/P2pDeliveryState';

interface QuickTileLoadingScreenProps {
  onLoadingComplete: () => void;
  overlayMode?: boolean;
}

export const QuickTileLoadingScreen: React.FC<QuickTileLoadingScreenProps> = ({
  onLoadingComplete,
  overlayMode,
}) => {
  const { t } = useTranslation('sync');

  const task = useCallback(async () => {
    const result = await getUnifiedContentService().sendCurrentClipboard();
    await persistP2pDeliveryReport(result.profileHash, result.report);
  }, []);

  return (
    <QuickLoadingPage
      task={task}
      loadingText={t('quickLoad.uploading')}
      successText={t('quickLoad.uploadSuccess')}
      failureText={t('quickLoad.uploadFailed')}
      onComplete={onLoadingComplete}
      overlayMode={overlayMode}
    />
  );
};
