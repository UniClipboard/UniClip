/**
 * Process Text Screen
 * 处理来自 Android 文字选中菜单（PROCESS_TEXT）的上传请求。
 * 复用 QuickLoadingPage：落库(importTextToHistory) + 走 Rust 引擎显式推送。
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { useSettingsStore } from '@/stores/settingsStore';
import { importTextToHistory } from '@/utils/uploadFile';
import { pushHistoryRecordViaEngine } from '@/stores/syncEngineStore';

interface ProcessTextScreenProps {
  text: string;
  onComplete: () => void;
}

export const ProcessTextScreen: React.FC<ProcessTextScreenProps> = ({ text, onComplete }) => {
  const { t } = useTranslation('share');
  const activeServer = useSettingsStore((s) => s.getActiveServer());

  const task = useCallback(
    async (signal: AbortSignal) => {
      if (!activeServer) throw new Error(t('processText.noServer'));
      const { profileHash } = await importTextToHistory(text, { signal });
      await pushHistoryRecordViaEngine(profileHash);
    },
    [text, activeServer, t]
  );

  return (
    <QuickLoadingPage
      task={task}
      loadingText={t('processText.loading')}
      successText={t('processText.success')}
      failureText={t('processText.failure')}
      onComplete={onComplete}
      previewText={text.length > 50 ? `${text.slice(0, 50)}…` : text}
    />
  );
};
