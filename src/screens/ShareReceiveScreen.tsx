/**
 * Share Receive Screen
 * 接收分享文件页面 - 当其他 App 分享文件到本 App 时显示。
 *
 * 业务语义:分享 = 先落本地(瞬时、必成功) + 后台推送。解析完成后立即把内容落库
 * (LocalOnly),把上传交给 BackgroundUploadManager 异步重试,然后立刻返回来源 app——
 * 不再让用户在「上传中」界面干等,服务端离线也不阻塞(内容已在本地,卡片显示待上传角标)。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, BackHandler, type ColorValue } from 'react-native';
import { Host, CircularProgressIndicator } from '@expo/ui/jetpack-compose';
import { useIncomingShare, clearSharedPayloads, getSharedPayloads } from 'expo-sharing';
import { useTheme } from '@/hooks/useTheme';
import { useMessageStore } from '@/stores/messageStore';
import { importFileToHistory, importTextToHistory } from '@/utils/uploadFile';
import { BackgroundUploadManager } from '@/services/BackgroundUploadManager';
import { log } from '@/services/Logger';

interface ShareReceiveScreenProps {
  /**
   * 分享处理结束的回调。
   * @param returnToSource true=返回来源 app（外部分享）；false=留在 app 内（截图等系统分享）。
   */
  onComplete: (returnToSource: boolean) => void;
}

/**
 * 截图 / 系统 UI 发起的分享所用的 content:// authority 特征。
 * - 小米 HyperOS 截图用 `com.miui.screeshot.provider.fileProvider`（注意小米把 screenshot 拼成了 screeshot）
 * - 原生 Android 截图用 `com.android.systemui...`
 * 命中任一特征 → 视为系统分享，完成后留在 app 内（moveTaskToBack 会退到桌面，体验差）。
 */
const SCREENSHOT_SHARE_AUTHORITY_HINTS = ['screeshot', 'screenshot', 'com.android.systemui'];

/** 从 content:// URI 取 authority（小写）；非 content:// 返回 null。 */
function getContentAuthority(uri: string | null | undefined): string | null {
  if (!uri) return null;
  const m = /^content:\/\/([^/]+)/i.exec(uri);
  return m ? m[1].toLowerCase() : null;
}

/** 判断原始分享 URI 是否来自截图/系统 UI（决定完成后是否留在 app 内）。 */
function isScreenshotShare(originalUri: string | null | undefined): boolean {
  const authority = getContentAuthority(originalUri);
  if (!authority) return false; // 文字/链接/非 content:// → 当作外部分享，返回来源
  return SCREENSHOT_SHARE_AUTHORITY_HINTS.some((hint) => authority.includes(hint));
}

function getFileExtFromMime(mimeType: string | null | undefined): string {
  if (!mimeType) return '';
  const parts = mimeType.split('/');
  if (parts.length < 2) return '';
  const sub = parts[1].split(';')[0].trim();
  if (sub === 'jpeg') return '.jpg';
  if (sub === 'svg+xml') return '.svg';
  if (sub === 'plain') return '.txt';
  if (sub === 'octet-stream') return '';
  return `.${sub}`;
}

export const ShareReceiveScreen: React.FC<ShareReceiveScreenProps> = ({ onComplete }) => {
  const { theme } = useTheme();

  const { resolvedSharedPayloads, isResolving, error: resolveError } = useIncomingShare();
  // 挂载时同步读取原始 payload，避免 hook 异步初始化导致误判"没有内容"
  const [hasShareContent] = useState(() => getSharedPayloads().length > 0);
  const showMessage = useMessageStore((s) => s.showMessage);
  const [savingText, setSavingText] = useState('正在解析分享内容…');
  // 落库只应执行一次，防止 effect 依赖变化重入
  const processedRef = useRef(false);

  // 挂载时若根本没有分享内容，直接返回（无 payload，按外部分享处理）
  useEffect(() => {
    if (!hasShareContent) {
      clearSharedPayloads();
      onComplete(true);
    }
  }, []);

  // 根据原始分享 URI 的来源决定完成后留在 app 还是返回来源 app
  const handleComplete = useCallback(() => {
    const originalUri = resolvedSharedPayloads[0]?.value;
    const returnToSource = !isScreenshotShare(originalUri);
    if (__DEV__) {
      log.info(
        `[share] authority=${
          getContentAuthority(originalUri) ?? 'none'
        } returnToSource=${returnToSource}`
      );
    }
    onComplete(returnToSource);
  }, [resolvedSharedPayloads, onComplete]);

  // 解析完成 → 落库(本地即完成) → 入队后台上传 → 立即返回。上传失败不阻塞分享,内容留在本地。
  useEffect(() => {
    if (!hasShareContent || processedRef.current) return;
    if (isResolving) return; // 等 expo-sharing 解析完成
    processedRef.current = true;

    (async () => {
      try {
        if (resolveError) throw new Error(`解析分享内容失败: ${resolveError.message}`);
        const payload = resolvedSharedPayloads[0];
        if (!payload) throw new Error('没有可处理的分享内容');

        setSavingText('正在保存…');

        // 文字分享（text / url 类型，contentUri 为 null）
        // 或 URL 分享（浏览器分享链接时 contentUri 是 https:// 而非本地文件）
        if (!payload.contentUri || payload.shareType === 'url') {
          const text = payload.value?.trim() || '';
          if (!text) throw new Error('分享的文字内容为空');
          const { profileHash } = await importTextToHistory(text);
          BackgroundUploadManager.enqueue(profileHash);
        } else {
          // 文件分享
          const contentMime = payload.contentMimeType;
          let fileName = payload.originalName;
          if (!fileName) {
            const ext = getFileExtFromMime(contentMime);
            fileName = `shared_${Date.now()}${ext}`;
          }
          const result = await importFileToHistory(
            payload.contentUri,
            fileName,
            contentMime,
            undefined
          );
          BackgroundUploadManager.enqueue(result.profileHash);
        }
        clearSharedPayloads();
      } catch (err) {
        // 落库失败(如解析错误/文件复制失败)才提示;上传失败不在此处(已交后台)。
        showMessage(err instanceof Error ? err.message : '保存失败', 'error');
      } finally {
        handleComplete();
      }
    })();
  }, [
    hasShareContent,
    isResolving,
    resolveError,
    resolvedSharedPayloads,
    handleComplete,
    showMessage,
  ]);

  if (!hasShareContent) return null;

  return (
    <SavingView
      text={savingText}
      backgroundColor={theme.colors.surface}
      textColor={theme.colors.textPrimary}
      primaryColor={theme.colors.accent}
      onBack={handleComplete}
    />
  );
};

/** 解析 / 保存阶段的极简 loading 界面（落库通常很快，随后自动返回来源 app） */
const SavingView: React.FC<{
  text: string;
  backgroundColor: ColorValue;
  textColor: ColorValue;
  primaryColor: ColorValue;
  onBack: () => void;
}> = ({ text, backgroundColor, textColor, primaryColor, onBack }) => {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={[styles.container, { backgroundColor }]}>
      <Host matchContents>
        <CircularProgressIndicator color={primaryColor} />
      </Host>
      <Text style={[styles.text, { color: textColor }]}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    fontSize: 16,
  },
});
