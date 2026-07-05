/**
 * 存储 section
 *
 * 显示缓存/日志/历史占用,提供清理缓存、清理日志(含确认弹窗)。占用数据来自共享的
 * storageSizes store;清理后调用 recalculate 统一刷新。
 * 作为 item:无独立 Host,两个确认弹窗作为 item 内 overlay 渲染(见 SettingsSectionItem.dialogs)。
 * 手动刷新入口移至二级页 navigator 的 headerRight。
 */
import React, { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListItem,
  Button,
  AlertDialog,
  TextButton,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { clearDirectory, CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { clearLogs } from '@/services';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';
import { useStorageSizesStore } from './storageSizes';

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const StorageSection = memo(function StorageSection() {
  const { t } = useTranslation('settingsStorage');
  const showMessage = useSettingsToast();

  const cacheSize = useStorageSizesStore((s) => s.cacheSize);
  const historySize = useStorageSizesStore((s) => s.historySize);
  const logSize = useStorageSizesStore((s) => s.logSize);
  const isCalculating = useStorageSizesStore((s) => s.isCalculating);
  const recalculate = useStorageSizesStore((s) => s.recalculate);

  const [showClearCacheDialog, setShowClearCacheDialog] = useState(false);
  const [showClearLogsDialog, setShowClearLogsDialog] = useState(false);

  useEffect(() => {
    recalculate();
  }, [recalculate]);

  const handleClearCacheConfirm = async () => {
    try {
      clearDirectory(CLIPBOARD_TEMP_DIR);
      await recalculate();
      showMessage(t('cache.cleared'), 'success');
    } catch {
      showMessage(t('cache.clearFailed'), 'error');
    }
  };

  const handleClearLogsConfirm = async () => {
    try {
      clearLogs();
      await recalculate();
      showMessage(t('log.cleared'), 'success');
    } catch {
      showMessage(t('log.clearFailed'), 'error');
    }
  };

  return (
    <SettingsSectionItem
      title={t('title')}
      dialogs={
        <>
          {showClearCacheDialog && (
            <AlertDialog onDismissRequest={() => setShowClearCacheDialog(false)}>
              <AlertDialog.Title>
                <ComposeText>{t('cache.clearDialogTitle')}</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>{t('cache.clearDialogMessage')}</ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton
                  onClick={() => {
                    handleClearCacheConfirm();
                    setShowClearCacheDialog(false);
                  }}
                >
                  <ComposeText>{t('action.confirm', { ns: 'common' })}</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
              <AlertDialog.DismissButton>
                <TextButton onClick={() => setShowClearCacheDialog(false)}>
                  <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
                </TextButton>
              </AlertDialog.DismissButton>
            </AlertDialog>
          )}

          {showClearLogsDialog && (
            <AlertDialog onDismissRequest={() => setShowClearLogsDialog(false)}>
              <AlertDialog.Title>
                <ComposeText>{t('log.clearDialogTitle')}</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>{t('log.clearDialogMessage')}</ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton
                  onClick={() => {
                    handleClearLogsConfirm();
                    setShowClearLogsDialog(false);
                  }}
                >
                  <ComposeText>{t('action.confirm', { ns: 'common' })}</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
              <AlertDialog.DismissButton>
                <TextButton onClick={() => setShowClearLogsDialog(false)}>
                  <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
                </TextButton>
              </AlertDialog.DismissButton>
            </AlertDialog>
          )}
        </>
      }
    >
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('cache.usageLabel')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>
            {isCalculating ? t('state.loading', { ns: 'common' }) : formatFileSize(cacheSize)}
          </ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <Button onClick={() => setShowClearCacheDialog(true)} enabled={!isCalculating}>
            <ComposeText>{t('cleanUp')}</ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('log.usageLabel')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>
            {isCalculating ? t('state.loading', { ns: 'common' }) : formatFileSize(logSize)}
          </ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <Button onClick={() => setShowClearLogsDialog(true)} enabled={!isCalculating}>
            <ComposeText>{t('cleanUp')}</ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('history.usageLabel')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>
            {isCalculating ? t('state.loading', { ns: 'common' }) : formatFileSize(historySize)}
          </ComposeText>
        </ListItem.SupportingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
