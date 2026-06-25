/**
 * 存储 section
 *
 * 显示缓存/日志/历史占用,提供清理缓存、清理日志(含确认弹窗)。占用数据来自共享的
 * storageSizes store;清理后调用 recalculate 统一刷新。
 * 作为 item:无独立 Host,两个确认弹窗作为 item 内 overlay 渲染(见 SettingsSectionItem.dialogs)。
 * 手动刷新入口移至二级页 navigator 的 headerRight。
 */
import React, { memo, useEffect, useState } from 'react';
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
      showMessage('缓存已清空', 'success');
    } catch {
      showMessage('清空缓存失败', 'error');
    }
  };

  const handleClearLogsConfirm = async () => {
    try {
      clearLogs();
      await recalculate();
      showMessage('日志已清空', 'success');
    } catch {
      showMessage('清空日志失败', 'error');
    }
  };

  return (
    <SettingsSectionItem
      title="存储"
      dialogs={
        <>
          {showClearCacheDialog && (
            <AlertDialog onDismissRequest={() => setShowClearCacheDialog(false)}>
              <AlertDialog.Title>
                <ComposeText>清空缓存</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>确定要清空缓存目录吗？这将删除所有缓存文件。</ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton
                  onClick={() => {
                    handleClearCacheConfirm();
                    setShowClearCacheDialog(false);
                  }}
                >
                  <ComposeText>确定</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
              <AlertDialog.DismissButton>
                <TextButton onClick={() => setShowClearCacheDialog(false)}>
                  <ComposeText>取消</ComposeText>
                </TextButton>
              </AlertDialog.DismissButton>
            </AlertDialog>
          )}

          {showClearLogsDialog && (
            <AlertDialog onDismissRequest={() => setShowClearLogsDialog(false)}>
              <AlertDialog.Title>
                <ComposeText>清空日志</ComposeText>
              </AlertDialog.Title>
              <AlertDialog.Text>
                <ComposeText>确定要清空日志目录吗？这将删除所有日志文件。</ComposeText>
              </AlertDialog.Text>
              <AlertDialog.ConfirmButton>
                <TextButton
                  onClick={() => {
                    handleClearLogsConfirm();
                    setShowClearLogsDialog(false);
                  }}
                >
                  <ComposeText>确定</ComposeText>
                </TextButton>
              </AlertDialog.ConfirmButton>
              <AlertDialog.DismissButton>
                <TextButton onClick={() => setShowClearLogsDialog(false)}>
                  <ComposeText>取消</ComposeText>
                </TextButton>
              </AlertDialog.DismissButton>
            </AlertDialog>
          )}
        </>
      }
    >
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>缓存空间占用</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>{isCalculating ? '加载中...' : formatFileSize(cacheSize)}</ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <Button onClick={() => setShowClearCacheDialog(true)} enabled={!isCalculating}>
            <ComposeText>清理</ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>日志空间占用</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>{isCalculating ? '加载中...' : formatFileSize(logSize)}</ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <Button onClick={() => setShowClearLogsDialog(true)} enabled={!isCalculating}>
            <ComposeText>清理</ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>历史记录空间占用</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>{isCalculating ? '加载中...' : formatFileSize(historySize)}</ComposeText>
        </ListItem.SupportingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
