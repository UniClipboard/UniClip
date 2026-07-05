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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('share');

  const { resolvedSharedPayloads, isResolving, error: resolveError } = useIncomingShare();
  // 挂载时同步读取原始 payload，避免 hook 异步初始化导致误判"没有内容"
  const [hasShareContent] = useState(() => getSharedPayloads().length > 0);
  const showMessage = useMessageStore((s) => s.showMessage);
  const [savingText, setSavingText] = useState(t('receive.parsing'));
  // 落库只应执行一次，防止 effect 依赖变化重入
  const processedRef = useRef(false);
  // useIncomingShare 的 isResolving 初始为 false，解析是在其内部 effect 里异步启动的
  // （启动时才 setIsResolving(true)）。因此单凭 !isResolving 无法区分「解析尚未开始」
  // 与「解析已结束」。此 ref 记录解析是否真正开始过一轮，供落库 effect 判定「已结束」。
  const resolveStartedRef = useRef(false);

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
    if (isResolving) {
      resolveStartedRef.current = true; // 记录解析确实开始过一轮
      return; // 解析进行中，等它结束
    }
    if (!hasShareContent || processedRef.current) return;
    // 关键守卫:必须等 expo-sharing 解析「真正结束」才落库。
    // isResolving 初始为 false 且解析异步启动 —— 首帧(isResolving 仍为 false、
    // resolvedSharedPayloads 仍为空)若直接放行,会拿空 payload 抛错并被 processedRef
    // 永久锁死,导致分享内容既不落库也不推送(表现为分享后一闪即返回)。
    // 「已结束」= 有解析结果 / 有解析错误 / 已实际解析过一轮(resolveStartedRef)。
    const resolutionSettled =
      resolveError != null || resolvedSharedPayloads.length > 0 || resolveStartedRef.current;
    if (!resolutionSettled) return;
    processedRef.current = true;

    (async () => {
      try {
        if (resolveError)
          throw new Error(t('receive.parseFailed', { message: resolveError.message }));
        const payload = resolvedSharedPayloads[0];
        if (!payload) throw new Error(t('receive.noContent'));

        setSavingText(t('receive.saving'));

        // 文字分享（text / url 类型，contentUri 为 null）
        // 或 URL 分享（浏览器分享链接时 contentUri 是 https:// 而非本地文件）
        if (!payload.contentUri || payload.shareType === 'url') {
          const text = payload.value?.trim() || '';
          if (!text) throw new Error(t('receive.emptyText'));
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
        showMessage(err instanceof Error ? err.message : t('receive.saveFailed'), 'error');
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
    t,
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
