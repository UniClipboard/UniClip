/**
 * Home Screen
 * 首页 - 显示当前剪贴板和同步状态
 */

import React, { useState, useLayoutEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as ClipboardProxy from '@/utils/clipboardProxy';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/hooks/useTheme';
import { spacing, radius, typography, elevation } from '@/theme';
import { useClipboardStore } from '@/stores/clipboardStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useClipboardSyncServiceStore } from '@/stores/ClipboardSyncServiceStore';
import { ClipboardContent } from '@/types/clipboard';
import { CurrentClipboardCard } from '@/components/CurrentClipboardCard';
import { MessageToast } from '@/components/MessageToast';
import { TopRightMenu, type MenuItemConfig } from '@/components/TopRightMenu';
import { WordPickerScreen } from '@/screens/WordPickerScreen';
import { copyToLocalClipboard } from '@/utils/clipboard';
import { useMessageStore } from '@/stores/messageStore';
import { useErrorStore } from '@/stores/errorStore';
import { QuickLoadingPage } from '@/components/QuickLoadingPage';
import { getClipboardSyncService } from '@/services/ClipboardSyncService';

export function HomeScreen() {
  const { theme } = useTheme();
  const navigation = useNavigation();
  const [refreshing, setRefreshing] = useState(false);
  const [fileUploadPayload, setFileUploadPayload] = useState<{
    uri: string;
    fileName: string;
    mimeType?: string | null;
    fileSize?: number;
  } | null>(null);
  const [wordPickerText, setWordPickerText] = useState<string | null>(null);
  const { error, setError, clearError } = useErrorStore();
  const { message, showMessage, clearMessage } = useMessageStore();

  // 远程剪贴板状态由 ClipboardSyncService 维护，从 store 读取
  const remoteContent = useClipboardSyncServiceStore((s) => s.remoteContent);
  const loadingRemote = useClipboardSyncServiceStore((s) => s.loadingRemote);
  const downloadingRemote = useClipboardSyncServiceStore((s) => s.downloadingRemote);
  const downloadProgress = useClipboardSyncServiceStore((s) => s.downloadProgress);
  const uploadingClipboard = useClipboardSyncServiceStore((s) => s.uploadingClipboard);
  const fileUploadProgress = useClipboardSyncServiceStore((s) => s.fileUploadProgress);

  const { currentContent } = useClipboardStore();
  const { getActiveServer } = useSettingsStore();

  const activeServer = getActiveServer();

  // 复制远程内容到本地剪贴板，同时通知服务记录哈希
  const copyRemoteToLocal = async (content: ClipboardContent, logPrefix: string = '') => {
    const result = await copyToLocalClipboard(content);
    if (result.success) {
      useClipboardStore.getState().setCurrentContentDisplay(content);
      getClipboardSyncService().recordLocalHash(content.profileHash || content.text || '');
      console.log(`[HomeScreen] ${logPrefix}Copy to local clipboard completed`);
    } else {
      console.error(`[HomeScreen] ${logPrefix}Copy to local clipboard failed: ${result.message}`);
    }
    return result;
  };

  // 复制本地剪贴板内容（简单模式，直接设置到剪贴板）
  const copyLocalToClipboard = async (content: ClipboardContent) => {
    try {
      const { clipboardManager } = await import('@/services');
      await clipboardManager.setClipboardContent(content);
      showMessage('Copied to clipboard', 'success');
    } catch (error) {
      console.error('[HomeScreen] Failed to copy local content:', error);
      showMessage('Copy failed', 'error');
    }
  };

  // 处理上传文件
  const handleUploadFile = useCallback(async () => {
    try {
      clearError();

      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset) {
        showMessage('No file selected', 'error');
        return;
      }

      setFileUploadPayload({
        uri: asset.uri,
        fileName: asset.name || 'file',
        mimeType: asset.mimeType,
        fileSize: asset.size,
      });
    } catch (error) {
      console.error('[HomeScreen] Failed to pick file:', error);
      showMessage('Failed to select file', 'error');
    }
  }, [showMessage]);

  // 处理上传图片
  const handleUploadImage = useCallback(async () => {
    try {
      clearError();

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset) {
        showMessage('No image selected', 'error');
        return;
      }

      setFileUploadPayload({
        uri: asset.uri,
        fileName: asset.fileName || `image_${Date.now()}.jpg`,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize,
      });
    } catch (error) {
      console.error('[HomeScreen] Failed to pick image:', error);
      showMessage('Failed to select image', 'error');
    }
  }, [showMessage]);

  const fileUploadTask = useCallback(
    async (signal: AbortSignal) => {
      if (!fileUploadPayload) throw new Error('No file to upload');

      await getClipboardSyncService().uploadFile(fileUploadPayload, signal);
    },
    [fileUploadPayload]
  );

  const handleFileUploadComplete = useCallback(() => {
    setFileUploadPayload(null);
  }, []);

  // 菜单项配置
  const menuItems = useMemo<MenuItemConfig[]>(
    () => [
      {
        label: 'Upload Image',
        onPress: handleUploadImage,
        disabled: !!fileUploadPayload,
      },
      {
        label: 'Upload File',
        onPress: handleUploadFile,
        disabled: !!fileUploadPayload,
      },
    ],
    [handleUploadImage, handleUploadFile, fileUploadPayload]
  );

  // 设置标题栏菜单按钮
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <TopRightMenu items={menuItems} />,
    });
  }, [navigation, menuItems]);

  // 下拉刷新：刷新本地 + 远程剪贴板内容，错误由 service 写入 errorStore
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await getClipboardSyncService().refreshContent();
    } finally {
      setRefreshing(false);
    }
  };

  // 快速操作
  const handleUpload = async () => {
    try {
      clearError();

      console.log('[HomeScreen] Starting upload...');
      const result = await getClipboardSyncService().triggerUpload();
      console.log('[HomeScreen] Upload result:', JSON.stringify(result, null, 2));

      if (result.success) {
        showMessage('Clipboard uploaded to server', 'success');
      } else {
        const errorMessage = result.error || 'Upload failed';
        console.log('[HomeScreen] Upload failed, setting error:', errorMessage);
        setError({
          title: 'Upload failed',
          message: errorMessage,
        });
        showMessage('Upload failed', 'error');
      }
    } catch (error: unknown) {
      console.error('[HomeScreen] Upload exception:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unable to upload to server';
      const normalizedMessage = errorMessage.toLowerCase();
      const isCanceled =
        (error instanceof Error && error.name === 'AbortError') ||
        normalizedMessage.includes('abort') ||
        normalizedMessage.includes('canceled') ||
        normalizedMessage.includes('cancelled');

      if (isCanceled) {
        showMessage('Upload cancelled', 'info');
        return;
      }

      const errorObj = error instanceof Error ? (error as unknown as Record<string, unknown>) : {};
      const errorDetails =
        error instanceof Error && errorObj.response
          ? JSON.stringify((errorObj.response as Record<string, unknown>).data, null, 2)
          : errorMessage;
      console.log('[HomeScreen] Setting error details:', errorDetails);
      setError({
        title: 'Upload failed',
        message: errorDetails,
      });
      showMessage('Upload failed', 'error');
    }
  };

  // 取消剪贴板上传
  const handleCancelClipboardUpload = useCallback(() => {
    if (!uploadingClipboard) {
      return;
    }

    getClipboardSyncService().cancelUpload();
    showMessage('Cancelling upload...', 'info');
  }, [uploadingClipboard, showMessage]);

  const handleCopyError = async () => {
    if (error) {
      await ClipboardProxy.setStringAsync(`${error.title}\n\n${error.message}`);
      showMessage('Error info copied', 'success');
    }
  };

  // 检查是否需要下载文件
  const needsDownload = useMemo(() => {
    if (!remoteContent) return false;
    return (
      (remoteContent.type === 'Text' &&
        remoteContent.hasData &&
        remoteContent.fileName &&
        !remoteContent.fileUri) ||
      (remoteContent.type === 'Image' && remoteContent.fileName && !remoteContent.fileUri) ||
      (remoteContent.type === 'File' && remoteContent.fileName && !remoteContent.fileUri)
    );
  }, [remoteContent]);

  // 下载远程剪贴板的文件数据
  const handleDownloadRemoteFile = async () => {
    if (!remoteContent || !needsDownload) return;
    try {
      await getClipboardSyncService().downloadRemoteFile();
    } catch (error) {
      console.error('[HomeScreen] Failed to download remote file:', error);
      showMessage('File download failed', 'error');
    }
  };

  // 取消下载
  const handleCancelDownload = useCallback(() => {
    getClipboardSyncService().cancelRemoteFileDownload();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* 当有服务器配置时显示远程和本地剪贴板 */}
        {activeServer ? (
          <>
            {/* 远程剪贴板 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                Remote Clipboard
              </Text>
              {loadingRemote ? (
                <View
                  style={[
                    styles.loadingCard,
                    { backgroundColor: theme.colors.surfaceContainerLow },
                  ]}
                >
                  <Text style={[styles.loadingText, { color: theme.colors.onSurfaceVariant }]}>
                    Loading...
                  </Text>
                </View>
              ) : (
                <CurrentClipboardCard
                  clipboard={remoteContent}
                  isRemote={true}
                  onDownload={handleDownloadRemoteFile}
                  downloading={downloadingRemote}
                  downloadProgress={downloadProgress}
                  onCancelDownload={handleCancelDownload}
                  onCopy={async (content) => {
                    const result = await copyRemoteToLocal(content, 'Manual copy: ');
                    if (result.success) {
      showMessage('Copied to clipboard', 'success');
                    } else {
                      showMessage(result.message || 'Copy failed', 'error');
                    }
                  }}
                  onWordPick={setWordPickerText}
                />
              )}
            </View>

            {/* 本地剪贴板 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                Local Clipboard
              </Text>
              <CurrentClipboardCard
                clipboard={currentContent}
                isRemote={false}
                onUpload={handleUpload}
                uploading={uploadingClipboard}
                onCancelUpload={handleCancelClipboardUpload}
                onCopy={copyLocalToClipboard}
                onWordPick={setWordPickerText}
              />

              {/* 错误信息卡片 — M3 errorContainer */}
              {error && (
                <View style={[styles.errorCard, { backgroundColor: theme.colors.errorContainer }]}>
                  <View style={styles.errorHeader}>
                    <Text style={[styles.errorTitle, { color: theme.colors.onErrorContainer }]}>
                      {error.title}
                    </Text>
                    <TouchableOpacity
                      style={[styles.copyButton, { backgroundColor: theme.colors.error }]}
                      onPress={handleCopyError}
                    >
                      <Text style={[styles.copyButtonText, { color: theme.colors.onError }]}>
                         Copy Error
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView style={styles.errorScrollView} nestedScrollEnabled={true}>
                    <Text style={[styles.errorText, { color: theme.colors.onErrorContainer }]}>
                      {error.message}
                    </Text>
                  </ScrollView>
                  <TouchableOpacity style={styles.dismissButton} onPress={() => clearError()}>
                    <Text
                      style={[styles.dismissButtonText, { color: theme.colors.onErrorContainer }]}
                    >
                        Dismiss
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            {/* 未配置服务器时只显示本地剪贴板 */}
            <CurrentClipboardCard
              clipboard={currentContent}
              isRemote={false}
              onCopy={copyLocalToClipboard}
              onWordPick={setWordPickerText}
            />
          </>
        )}

        {/* 空状态提示 */}
        {!activeServer && (
          <View style={[styles.emptyState, { backgroundColor: theme.colors.surfaceContainerLow }]}>
            <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>No Server Configured</Text>
            <Text style={[styles.emptyStateText, { color: theme.colors.onSurfaceVariant }]}>
              Add a server in Settings to enable sync
            </Text>
          </View>
        )}

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* 消息提示 */}
      <MessageToast message={message} onMessageShown={clearMessage} />

      {fileUploadPayload && (
        <View style={styles.fullScreenOverlay}>
          <QuickLoadingPage
            task={fileUploadTask}
            loadingText={fileUploadProgress?.stage ?? 'Processing file...'}
            successText="Upload successful"
            failureText="Upload failed"
            onComplete={handleFileUploadComplete}
            progress={fileUploadProgress?.progressInfo}
            previewText={fileUploadPayload.fileName}
            previewImage={
              fileUploadPayload.mimeType?.startsWith('image/') ? fileUploadPayload.uri : undefined
            }
          />
        </View>
      )}

      {wordPickerText && (
        <View style={styles.fullScreenOverlay}>
          <WordPickerScreen text={wordPickerText} onComplete={() => setWordPickerText(null)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  fullScreenOverlay: {
    ...StyleSheet.absoluteFill,
  },

  infoLabelSpaced: {
    marginTop: spacing.sm,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.base,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.sectionHeader.fontSize,
    lineHeight: typography.sectionHeader.lineHeight,
    fontWeight: typography.sectionHeader.fontWeight,
    letterSpacing: typography.sectionHeader.letterSpacing,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  loadingCard: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    padding: spacing.base,
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.sm,
  },
  loadingText: {
    fontSize: typography.subhead.fontSize,
  },
  emptyState: {
    marginTop: spacing.base,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    alignItems: 'center',
    ...elevation.sm,
  },
  emptyStateTitle: {
    fontSize: typography.title3.fontSize,
    lineHeight: typography.title3.lineHeight,
    fontWeight: typography.title3.fontWeight,
    marginBottom: spacing.sm,
  },
  emptyStateText: {
    fontSize: typography.subhead.fontSize,
    textAlign: 'center',
    lineHeight: 22,
  },
  infoCard: {
    marginTop: spacing.base,
    padding: spacing.base,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
  infoLabel: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: typography.subhead.fontSize,
    marginTop: spacing.xs,
  },
  bottomPadding: {
    height: 100,
  },
  errorCard: {
    marginTop: spacing.base,
    padding: spacing.base,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
  errorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  errorTitle: {
    fontSize: typography.headline.fontSize,
    fontWeight: typography.headline.fontWeight,
  },
  copyButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  copyButtonText: {
    fontSize: typography.footnote.fontSize,
    fontWeight: '600',
  },
  errorScrollView: {
    maxHeight: 200,
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: typography.footnote.fontSize,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  dismissButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  dismissButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
