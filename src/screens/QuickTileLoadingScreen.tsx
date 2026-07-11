import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import { showToast } from '@/utils/toast';
import { SyncDirection } from '@/types/sync';
import { ClipboardContent } from '@/types/clipboard';
import { SyncManager } from '@/services/SyncManager';
import { useSyncStore } from '@/stores/syncStore';
import { openFile, shareFile, saveFile, saveToGallery } from '@/utils/fileActions';
import { isTextInvalid } from '@/utils/index';
import { QuickLoadingPage, SuccessButtonConfig } from '@/components/QuickLoadingPage';
import type { ProgressInfo } from 'android-util';
import * as Clipboard from 'expo-clipboard';
import { log } from '@/services/Logger';

interface QuickTileLoadingScreenProps {
  direction: SyncDirection;
  onLoadingComplete: () => void;
  overlayMode?: boolean;
}

export const QuickTileLoadingScreen: React.FC<QuickTileLoadingScreenProps> = ({
  direction,
  onLoadingComplete,
  overlayMode,
}) => {
  const isUpload = direction === SyncDirection.Upload;
  const { t } = useTranslation('sync');

  // 用 state 存储下载的文件内容，触发重渲染以更新 successButtons prop
  const [fileContent, setFileContent] = useState<ClipboardContent | null>(null);
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [previewText, setPreviewText] = useState<string | undefined>(undefined);

  const task = useCallback(
    async (signal: AbortSignal) => {
      setFileContent(null);
      setProgress(null);
      setPreviewText(undefined);

      // 确保 SyncManager 已初始化（冷启动时尚未经过正常启动流程）
      await useSyncStore.getState().initialize();
      const initError = useSyncStore.getState().error;
      if (initError) throw new Error(initError);

      const syncMgr = SyncManager.getInstance();
      const result = await syncMgr.sync(
        direction,
        false,
        signal,
        (info) => setProgress(info),
        (preview) => setPreviewText(preview)
      );

      if (!result.success) {
        throw new Error(
          result.error || (isUpload ? t('quickLoad.uploadFailed') : t('quickLoad.downloadFailed'))
        );
      }

      const content = result.content;

      // 只有文本类型才显示 Toast 提示
      if (content && content.type === 'Text' && !isTextInvalid(content.text)) {
        const preview = content.text.trim().replace(/\s+/g, ' ');
        const toastMessage = preview.length > 40 ? preview.slice(0, 40) + '…' : preview;
        showToast(toastMessage);

        // 文本中包含 URL 时，存入 state 以显示操作按钮
        const urlRegex = /https?:\/\/[^\s<>"'()\]\[{}]+/i;
        const urlMatch = content.text.match(urlRegex);
        if (urlMatch) {
          setFileContent(content);
        }
      }

      // 下载了非文本文件时，存入 state，触发重渲染更新 successButtons
      if (!isUpload && content && content.type !== 'Text' && content.fileUri) {
        setFileContent(content);
      }
    },
    [direction, isUpload, t]
  );

  // 检测文本中的 URL
  const textUrl = useMemo(() => {
    if (!fileContent || fileContent.type !== 'Text' || !fileContent.text) return null;
    const urlRegex = /https?:\/\/[^\s<>"'()\]\[{}]+/i;
    const match = fileContent.text.match(urlRegex);
    return match ? match[0] : null;
  }, [fileContent]);

  const successButtons: SuccessButtonConfig[] | undefined = fileContent
    ? fileContent.type === 'Text' && textUrl
      ? [
          {
            label: t('action.copy', { ns: 'common' }),
            primary: true,
            onPress: async () => {
              try {
                await Clipboard.setStringAsync(fileContent.text!);
                showToast(t('toast.copied'));
              } catch {}
            },
          },
          {
            label: t('quickLoad.openLink'),
            primary: true,
            onPress: async () => {
              try {
                await Linking.openURL(textUrl);
              } catch {}
            },
          },
        ]
      : [
          {
            label: t('action.open', { ns: 'common' }),
            primary: true,
            onPress: async () => {
              try {
                await openFile(fileContent.fileUri!);
              } catch {}
            },
          },
          {
            label: t('action.save', { ns: 'common' }),
            primary: true,
            onPress: async () => {
              try {
                if (fileContent.type === 'Image') {
                  await saveToGallery(fileContent.fileUri!);
                  showToast(t('toast.savedToGallery'));
                } else {
                  const saved = await saveFile(fileContent.fileUri!, fileContent.fileName);
                  if (saved) {
                    showToast(t('toast.savedToDevice'));
                  }
                }
              } catch (error) {
                log.error('[QuickTileLoadingScreen] Failed to save file:', error);
                if (error instanceof Error && error.message === 'Media library permission denied') {
                  showToast(t('toast.needGalleryPermission'));
                  return;
                }
                showToast(t('toast.saveFailed'));
              }
            },
          },
          {
            label: t('action.share', { ns: 'common' }),
            primary: true,
            onPress: async () => {
              try {
                await shareFile(fileContent.fileUri!, fileContent.fileName);
              } catch {}
            },
          },
        ]
    : undefined;

  return (
    <QuickLoadingPage
      task={task}
      loadingText={isUpload ? t('quickLoad.uploading') : t('quickLoad.downloading')}
      successText={isUpload ? t('quickLoad.uploadSuccess') : t('quickLoad.downloadSuccess')}
      failureText={isUpload ? t('quickLoad.uploadFailed') : t('quickLoad.downloadFailed')}
      onComplete={onLoadingComplete}
      successContent={fileContent ?? undefined}
      successButtons={successButtons}
      progress={progress}
      previewText={previewText}
      overlayMode={overlayMode}
    />
  );
};
