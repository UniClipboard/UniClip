/**
 * ShareReceiveRedirector — Android 哑接收(§6.2)
 *
 * 职责:把 expo-sharing 解析出的分享 payload **立即转存**为统一 pending job
 * (文本 → stageText;图片/文件 → stageAsset),消费 intent 数据后打开主应用
 * 分享弹层。不再自动落库/自动发送/返回来源应用 —— 发送统一在分享页完成。
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, BackHandler, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIncomingShare, clearSharedPayloads, getSharedPayloads } from 'expo-sharing';
import { useShareSheetStore } from '@/stores/shareSheetStore';
import { createPendingShareStore } from '@/features/transfer';
import { useMessageStore } from '@/stores/messageStore';
import { createLogger } from '@/support/observability';

const log = createLogger('ShareReceiveRedirector');

interface ShareReceiveRedirectorProps {
  /** 转存完成(或放弃)后卸载 overlay 的回调。 */
  onComplete: () => void;
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

export const ShareReceiveRedirector: React.FC<ShareReceiveRedirectorProps> = ({ onComplete }) => {
  const { t } = useTranslation('share');

  const { resolvedSharedPayloads, isResolving, error: resolveError } = useIncomingShare();
  // 挂载时同步读取原始 payload,避免 hook 异步初始化导致误判「没有内容」
  const [hasShareContent] = React.useState(() => getSharedPayloads().length > 0);
  const showMessage = useMessageStore((s) => s.showMessage);
  // 转存只应执行一次,防止 effect 依赖变化重入(重复 intent 幂等)
  const processedRef = useRef(false);
  // useIncomingShare 的 isResolving 初始为 false,解析是异步启动的;此 ref 记录
  // 解析是否真正开始过一轮,用于区分「尚未开始」与「已结束」。
  const resolveStartedRef = useRef(false);

  // 挂载时若根本没有分享内容,直接结束(旧安装包缓存已被消费,不重复入队)
  useEffect(() => {
    if (!hasShareContent) {
      clearSharedPayloads();
      onComplete();
    }
  }, []);

  useEffect(() => {
    if (isResolving) {
      resolveStartedRef.current = true; // 记录解析确实开始过一轮
      return; // 解析进行中,等它结束
    }
    if (!hasShareContent || processedRef.current) return;
    // 关键守卫:必须等 expo-sharing 解析「真正结束」才转存(与旧 ShareReceiveScreen
    // 相同的时序语义:首帧 isResolving=false 时直接放行会拿空 payload 并锁死)。
    const resolutionSettled =
      resolveError != null || resolvedSharedPayloads.length > 0 || resolveStartedRef.current;
    if (!resolutionSettled) return;
    processedRef.current = true;

    (async () => {
      const store = createPendingShareStore();
      try {
        if (resolveError)
          throw new Error(t('receive.parseFailed', { message: resolveError.message }));
        if (resolvedSharedPayloads.length === 0) throw new Error(t('receive.noContent'));
        // 解析完成即转存(进程被杀不丢),逐个 payload 串行写入
        for (const payload of resolvedSharedPayloads) {
          // 文字/URL 分享(contentUri 为 null,或浏览器分享链接时 contentUri 是 https://)
          if (!payload.contentUri || payload.shareType === 'url') {
            const text = payload.value?.trim() || '';
            if (!text) throw new Error(t('receive.emptyText'));
            await store.stageText(text);
          } else {
            let fileName = payload.originalName;
            if (!fileName) {
              const ext = getFileExtFromMime(payload.contentMimeType);
              fileName = `shared_${Date.now()}${ext}`;
            }
            await store.stageAsset(payload.contentUri, fileName, payload.contentMimeType);
          }
        }
      } catch (err) {
        // 转存失败:保留 toast 提示,仍导航到分享页(空队列页显示「暂无待发送内容」)
        log.warn('Failed to stage shared payload', {
          reason: err instanceof Error ? err.name : 'unknown',
        });
        showMessage(err instanceof Error ? err.message : t('receive.saveFailed'), 'error');
      } finally {
        // 只消费一次 intent 数据;重复 intent 不再产生重复 job
        clearSharedPayloads();
        useShareSheetStore.getState().open();
        onComplete();
      }
    })();
  }, [
    hasShareContent,
    isResolving,
    resolveError,
    resolvedSharedPayloads,
    showMessage,
    t,
    onComplete,
  ]);

  if (!hasShareContent) return null;

  return <SavingView text={t('receive.parsing')} onBack={onComplete} />;
};

/** 转存阶段的极简 loading 界面(通常瞬间完成) */
const SavingView: React.FC<{ text: string; onBack: () => void }> = ({ text, onBack }) => {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.text}>{text}</Text>
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
