/**
 * QuickLoadingPage
 * 通用"快速加载"页：执行一个异步 task，处理 loading / success / error 状态显示。
 * 纯 UI + 状态机，不含任何业务逻辑。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Image,
  TouchableWithoutFeedback,
  BackHandler,
  ScrollView,
} from 'react-native';
import {
  Host,
  Button,
  OutlinedButton,
  CircularProgressIndicator,
  LinearProgressIndicator,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '@/hooks/useTheme';
import { spacing, radius, typography, elevation } from '@/theme';
import type { ClipboardContent } from '@/types/clipboard';
import type { ProgressInfo } from 'native-util';
import { formatFileSize, isTextInvalid } from '@/utils';

type LoadingState = 'loading' | 'success' | 'error';

export interface SuccessButtonConfig {
  label: string;
  onPress: () => void;
  primary?: boolean;
}

export interface QuickLoadingPageProps {
  task: (signal: AbortSignal) => Promise<void>;
  loadingText: string;
  successText: string;
  failureText: string;
  onComplete: () => void;
  successContent?: ClipboardContent;
  successButtons?: SuccessButtonConfig[];
  progress?: ProgressInfo | null;
  previewText?: string;
  previewImage?: string;
  /** When true, renders as a floating card over a semi-transparent backdrop (for transparent Activity). */
  overlayMode?: boolean;
}

export const QuickLoadingPage: React.FC<QuickLoadingPageProps> = ({
  task,
  loadingText,
  successText,
  failureText,
  onComplete,
  successContent,
  successButtons,
  progress,
  previewText,
  previewImage,
  overlayMode,
}) => {
  const { theme } = useTheme();
  const [state, setState] = useState<LoadingState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 用 ref 持有 task，避免 task 引用变化触发 useEffect 重复执行
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  // AbortController 用于取消任务
  const abortControllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    setState('loading');
    setErrorMessage(null);

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      await taskRef.current(signal);
      setState('success');
    } catch (err) {
      // 如果是取消操作，直接返回，不显示错误
      if (signal.aborted) {
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : '操作失败，请重试');
      setState('error');
    }
    // run 仅用 taskRef/setState(均稳定),不依赖 onComplete。旧代码误加 [onComplete]:
    // 父组件每次重渲染都传入新的内联 onComplete → run 重建 → 下方 useEffect 重跑 →
    // cleanup abort 掉正在进行的任务再重启,导致「取消」被自身进度更新架空、任务自循环。
  }, []);

  useEffect(() => {
    run();
    return () => {
      // 组件卸载时取消任务
      abortControllerRef.current?.abort();
    };
  }, [run]);

  // 取消任务
  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    onComplete();
  }, [onComplete]);

  // 成功后：无 successContent 且无 successButtons 时自动关闭
  // 放在独立 useEffect 中，确保在 React 批处理完成、父组件更新 successButtons prop 后再判断
  useEffect(() => {
    if (state !== 'success') return;
    if (successContent !== undefined || (successButtons && successButtons.length > 0)) return;
    // 无需显示成功界面，直接退出
    onComplete();
  }, [state, successContent, successButtons, onComplete]);

  // 返回键：loading 时允许取消；error / success-with-content/extra 时允许离开
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state === 'loading') {
        handleCancel();
        return true;
      }
      if (
        state === 'error' ||
        (state === 'success' &&
          (successContent !== undefined || (successButtons && successButtons.length > 0)))
      ) {
        onComplete();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [state, successContent, successButtons, onComplete, handleCancel]);

  const containerBg = overlayMode
    ? { backgroundColor: 'transparent' }
    : { backgroundColor: theme.colors.surface };

  const contentView = (
    <View
      style={[
        styles.content,
        overlayMode && [styles.overlayCard, { backgroundColor: theme.colors.surfaceHigh }],
      ]}
    >
      {state === 'loading' && (
        <>
          <Host matchContents>
            <CircularProgressIndicator color={theme.colors.accent} />
          </Host>
          <Text style={[styles.statusText, { color: theme.colors.textPrimary }]}>
            {loadingText}
          </Text>
          {previewImage && (
            <Image source={{ uri: previewImage }} style={styles.loadingPreviewImage} />
          )}
          {previewText && (
            <Text style={[styles.loadingPreviewText, { color: theme.colors.textSecondary }]}>
              {previewText}
            </Text>
          )}
          {progress && (progress.totalBytes > 0 || progress.bytesTransferred > 0) && (
            <View style={styles.progressContainer}>
              <Host matchContents style={styles.progressHost}>
                <LinearProgressIndicator
                  progress={progress.totalBytes > 0 ? progress.progress : undefined}
                  color={theme.colors.accent}
                  trackColor={theme.colors.separator}
                  modifiers={[fillMaxWidth()]}
                />
              </Host>
              <Text style={[styles.progressText, { color: theme.colors.textSecondary }]}>
                {progress.totalBytes > 0
                  ? `${(progress.progress * 100).toFixed(0)}% ${formatFileSize(
                      progress.bytesTransferred
                    )} / ${formatFileSize(progress.totalBytes)}`
                  : formatFileSize(progress.bytesTransferred)}
              </Text>
            </View>
          )}
          <Host matchContents>
            <OutlinedButton onClick={handleCancel} colors={{ contentColor: theme.colors.accent }}>
              <ComposeText>取消</ComposeText>
            </OutlinedButton>
          </Host>
        </>
      )}

      {state === 'success' && (
        <>
          {successContent && <ContentPreview content={successContent} />}
          {!(successButtons && successButtons.length > 0) && (
            <>
              <Text style={[styles.successIcon, { color: theme.colors.success }]}>✓</Text>
              <Text style={[styles.statusText, { color: theme.colors.textPrimary }]}>
                {successText}
              </Text>
            </>
          )}
          {(successContent !== undefined || (successButtons && successButtons.length > 0)) && (
            <View style={styles.successButtonRow}>
              {successButtons?.map((btn, index) => (
                <Host matchContents key={index} style={styles.successButtonHost}>
                  {btn.primary ? (
                    <Button
                      onClick={btn.onPress}
                      modifiers={[fillMaxWidth()]}
                      colors={{
                        containerColor: theme.colors.accentContainer,
                        contentColor: theme.colors.onAccentContainer,
                      }}
                    >
                      <ComposeText>{btn.label}</ComposeText>
                    </Button>
                  ) : (
                    <OutlinedButton
                      onClick={btn.onPress}
                      modifiers={[fillMaxWidth()]}
                      colors={{ contentColor: theme.colors.accent }}
                    >
                      <ComposeText>{btn.label}</ComposeText>
                    </OutlinedButton>
                  )}
                </Host>
              ))}
              <Host matchContents style={styles.successButtonHost}>
                <OutlinedButton
                  onClick={onComplete}
                  modifiers={[fillMaxWidth()]}
                  colors={{ contentColor: theme.colors.accent }}
                >
                  <ComposeText>返回</ComposeText>
                </OutlinedButton>
              </Host>
            </View>
          )}
        </>
      )}

      {state === 'error' && (
        <>
          <Text style={[styles.errorIcon, { color: theme.colors.error }]}>✗</Text>
          <Text style={[styles.statusText, { color: theme.colors.textPrimary }]}>
            {failureText}
          </Text>
          {errorMessage && (
            <ScrollView
              style={[
                styles.errorDetailScroll,
                {
                  borderColor: theme.colors.separator,
                  backgroundColor: theme.colors.errorContainer,
                },
              ]}
              contentContainerStyle={styles.errorDetailScrollContent}
            >
              <Text style={[styles.errorDetailText, { color: theme.colors.onErrorContainer }]}>
                {errorMessage}
              </Text>
            </ScrollView>
          )}
          <View style={styles.buttonRow}>
            <Host matchContents>
              <Button
                onClick={run}
                colors={{
                  containerColor: theme.colors.accentContainer,
                  contentColor: theme.colors.onAccentContainer,
                }}
              >
                <ComposeText>重试</ComposeText>
              </Button>
            </Host>
            {errorMessage && (
              <Host matchContents>
                <OutlinedButton
                  onClick={() => Clipboard.setStringAsync(errorMessage)}
                  colors={{ contentColor: theme.colors.accent }}
                >
                  <ComposeText>复制</ComposeText>
                </OutlinedButton>
              </Host>
            )}
            <Host matchContents>
              <OutlinedButton onClick={onComplete} colors={{ contentColor: theme.colors.accent }}>
                <ComposeText>返回</ComposeText>
              </OutlinedButton>
            </Host>
          </View>
        </>
      )}
    </View>
  );

  return (
    <View style={[styles.container, containerBg]}>
      {overlayMode ? (
        <TouchableWithoutFeedback
          onPress={() => {
            if (state !== 'loading') onComplete();
          }}
        >
          <View style={styles.overlayBackdrop}>{contentView}</View>
        </TouchableWithoutFeedback>
      ) : (
        contentView
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// ContentPreview – inline preview of a ClipboardContent result
// ---------------------------------------------------------------------------

const ContentPreview: React.FC<{ content: ClipboardContent }> = ({ content }) => {
  const { theme } = useTheme();

  if (content.type === 'Image' && content.fileUri) {
    return (
      <Image source={{ uri: content.fileUri }} style={styles.previewImage} resizeMode="contain" />
    );
  }

  if (content.type === 'Text' && !isTextInvalid(content.text)) {
    return (
      <View
        style={[
          styles.previewTextBox,
          { backgroundColor: theme.colors.background, borderColor: theme.colors.separator },
        ]}
      >
        <Text
          style={[styles.previewText, { color: theme.colors.textPrimary }]}
          numberOfLines={6}
          ellipsizeMode="tail"
        >
          {content.text}
        </Text>
      </View>
    );
  }

  // File (or Image without local URI)
  const label = content.fileName ?? content.text ?? '未知文件';
  const size = content.fileSize != null ? ` · ${(content.fileSize / 1024).toFixed(1)} KB` : '';
  return (
    <View
      style={[
        styles.previewFileBox,
        { backgroundColor: theme.colors.background, borderColor: theme.colors.separator },
      ]}
    >
      <Text style={[styles.previewFileIcon, { color: theme.colors.accent }]}>📄</Text>
      <Text style={[styles.previewFileName, { color: theme.colors.textPrimary }]} numberOfLines={2}>
        {label}
      </Text>
      {size !== '' && (
        <Text style={[styles.previewFileMeta, { color: theme.colors.textTertiary }]}>
          {size.trim()}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: spacing.xl,
    gap: spacing.base,
  },
  statusText: {
    fontSize: typography.callout.fontSize,
  },
  successIcon: {
    fontSize: 48,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorDetailScroll: {
    maxHeight: 200,
    width: '100%',
    maxWidth: 280,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorDetailScrollContent: {
    padding: spacing.md,
  },
  errorDetailText: {
    fontSize: typography.footnote.fontSize,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  successButtonRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
    width: '100%',
  },
  successButtonHost: {
    flex: 1,
  },
  loadingPreviewText: {
    fontSize: 14,
    textAlign: 'center',
    maxWidth: 280,
  },
  loadingPreviewImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  progressContainer: {
    width: '100%',
    maxWidth: 280,
    alignItems: 'center',
    gap: 8,
  },
  progressHost: {
    width: '100%',
  },
  progressText: {
    fontSize: 13,
  },
  previewImage: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 320,
    borderRadius: 12,
  },
  previewTextBox: {
    width: 280,
    maxHeight: 160,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 20,
  },
  previewFileBox: {
    width: 280,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    alignItems: 'center',
    gap: 6,
  },
  previewFileIcon: {
    fontSize: 32,
  },
  previewFileName: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  previewFileMeta: {
    fontSize: 12,
  },
  overlayBackdrop: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayCard: {
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    paddingVertical: spacing.xl + spacing.xs,
    paddingHorizontal: spacing.xl,
    width: '85%',
    alignSelf: 'center',
    ...elevation.lg,
  },
});
