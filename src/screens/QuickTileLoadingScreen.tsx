import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { getUnifiedContentService } from '@/features/transfer';

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
    await getUnifiedContentService().sendCurrentClipboard();
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
