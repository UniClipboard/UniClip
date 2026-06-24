/**
 * 存储 section
 *
 * 显示缓存/日志/历史占用，提供清理缓存、清理日志（含确认弹窗）。占用数据来自共享的
 * storageSizes store；清理后调用 recalculate 统一刷新。
 */
import React, { memo, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import {
  Host,
  Card,
  Column,
  ListItem,
  Button,
  AlertDialog,
  TextButton,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { RefreshCw } from 'react-native-feather';
import { useTheme } from '@/hooks/useTheme';
import { clearDirectory, CLIPBOARD_TEMP_DIR } from '@/utils/fileStorage';
import { clearLogs } from '@/services';
import { useSettingsToast } from './SettingsToastContext';
import { settingsStyles as styles } from './settingsStyles';
import { useStorageSizesStore } from './storageSizes';

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const StorageSection = memo(function StorageSection() {
  const { theme } = useTheme();
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

  const buttonColors = { containerColor: theme.colors.primary, contentColor: theme.colors.white };

  return (
    <>
      <View style={styles.section}>
        <View style={[styles.sectionHeaderBase, styles.sectionHeaderRow]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>存储</Text>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={recalculate}
            disabled={isCalculating}
          >
            <RefreshCw color={theme.colors.primary} width={16} height={16} />
          </TouchableOpacity>
        </View>

        <Host matchContents={{ vertical: true }} style={styles.hostFill}>
          <Card colors={{ containerColor: theme.colors.surface }}>
            <Column modifiers={[fillMaxWidth()]}>
              <ListItem colors={{ containerColor: theme.colors.surface }}>
                <ListItem.HeadlineContent>
                  <ComposeText color={theme.colors.text}>缓存空间占用</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText color={theme.colors.textTertiary}>
                    {isCalculating ? '加载中...' : formatFileSize(cacheSize)}
                  </ComposeText>
                </ListItem.SupportingContent>
                <ListItem.TrailingContent>
                  <Button
                    onClick={() => setShowClearCacheDialog(true)}
                    enabled={!isCalculating}
                    colors={buttonColors}
                  >
                    <ComposeText>清理</ComposeText>
                  </Button>
                </ListItem.TrailingContent>
              </ListItem>

              <HorizontalDivider color={theme.colors.divider} />

              <ListItem colors={{ containerColor: theme.colors.surface }}>
                <ListItem.HeadlineContent>
                  <ComposeText color={theme.colors.text}>日志空间占用</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText color={theme.colors.textTertiary}>
                    {isCalculating ? '加载中...' : formatFileSize(logSize)}
                  </ComposeText>
                </ListItem.SupportingContent>
                <ListItem.TrailingContent>
                  <Button
                    onClick={() => setShowClearLogsDialog(true)}
                    enabled={!isCalculating}
                    colors={buttonColors}
                  >
                    <ComposeText>清理</ComposeText>
                  </Button>
                </ListItem.TrailingContent>
              </ListItem>

              <HorizontalDivider color={theme.colors.divider} />

              <ListItem colors={{ containerColor: theme.colors.surface }}>
                <ListItem.HeadlineContent>
                  <ComposeText color={theme.colors.text}>历史记录空间占用</ComposeText>
                </ListItem.HeadlineContent>
                <ListItem.SupportingContent>
                  <ComposeText color={theme.colors.textTertiary}>
                    {isCalculating ? '加载中...' : formatFileSize(historySize)}
                  </ComposeText>
                </ListItem.SupportingContent>
              </ListItem>
            </Column>
          </Card>
        </Host>
      </View>

      <Host>
        {showClearCacheDialog && (
          <AlertDialog
            onDismissRequest={() => setShowClearCacheDialog(false)}
            colors={{ containerColor: theme.colors.surface }}
          >
            <AlertDialog.Title>
              <ComposeText color={theme.colors.text}>清空缓存</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText color={theme.colors.textSecondary}>
                确定要清空缓存目录吗？这将删除所有缓存文件。
              </ComposeText>
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
          <AlertDialog
            onDismissRequest={() => setShowClearLogsDialog(false)}
            colors={{ containerColor: theme.colors.surface }}
          >
            <AlertDialog.Title>
              <ComposeText color={theme.colors.text}>清空日志</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText color={theme.colors.textSecondary}>
                确定要清空日志目录吗？这将删除所有日志文件。
              </ComposeText>
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
      </Host>
    </>
  );
});
