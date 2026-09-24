import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import type { ColorScheme } from '@/theme/colors.types';
import { useShareSheetStore } from '@/stores/shareSheetStore';
import type { ShareSendSheetProps } from './ShareSendSheet.types';
import {
  useShareSendController,
  formatBytes,
  type ShareJobView,
  type ShareTarget,
} from './useShareSendController';
import { M3IconButton } from '@/components/android/M3IconButton';
import { m3Type } from '@/theme/m3Typography';

/** Android 外部分享独立页面。解析与发送都在同一全屏页面完成。 */
export function ShareSendSheet({ visible, onClose, jobs, title }: ShareSendSheetProps) {
  // 解析状态只属于外部分享队列;应用自带 jobs 的实例不受其影响。
  const isParsing = useShareSheetStore((state) => state.isParsing) && !jobs;
  const c = useShareSendController(onClose, visible && !isParsing, jobs);
  const { theme } = useTheme();
  const { t } = useTranslation('share');
  const insets = useSafeAreaInsets();
  const pageTitle = title ?? t('send.title');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.page,
          { backgroundColor: theme.colors.surfaceLow, paddingTop: Math.max(insets.top, 16) },
        ]}
      >
        <PageHeader title={pageTitle} onClose={onClose} theme={theme.colors} />
        {isParsing ? <ParsingState /> : <ShareBody c={c} theme={theme.colors} title={pageTitle} />}
      </View>
    </Modal>
  );
}

function PageHeader({
  title,
  onClose,
  theme,
}: {
  title: string;
  onClose: () => void;
  theme: ColorScheme;
}) {
  const { t } = useTranslation('history');
  // M3 全屏页标题栏:前导关闭、标题靠左,不做 iOS 式居中 + 右侧占位
  return (
    <View style={styles.header}>
      <M3IconButton
        icon="close"
        accessibilityLabel={t('action.close', { ns: 'common' })}
        onPress={onClose}
        iconColor={theme.textPrimary}
        colors={theme}
      />
      <Text
        style={[styles.title, { color: theme.textPrimary }]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
    </View>
  );
}

function ParsingState() {
  const { t } = useTranslation('share');
  const { theme } = useTheme();
  return (
    <View style={styles.centerBox}>
      <ActivityIndicator size="large" color={theme.colors.accent} />
      <Text style={[styles.parsingText, { color: theme.colors.textPrimary }]}>
        {t('receive.parsing')}
      </Text>
    </View>
  );
}

function ShareBody({
  c,
  theme,
  title,
}: {
  c: ReturnType<typeof useShareSendController>;
  theme: ColorScheme;
  title: string;
}) {
  const { t } = useTranslation('share');
  const hasFailed = c.jobViews.some((view) => view.sendState === 'failed');

  if (c.phase.kind === 'claiming') {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (c.phase.kind === 'error') {
    return (
      <View style={styles.centerBox}>
        <Ionicons name="alert-circle-outline" size={42} color={theme.textSecondary} />
        <Text style={[styles.errorText, { color: theme.textSecondary }]}>{c.phase.message}</Text>
        <Pressable
          onPress={c.handleRetryClaim}
          android_ripple={{ color: theme.fillSecondary as string }}
          style={[styles.retryButton, { backgroundColor: theme.accentContainer }]}
          accessibilityRole="button"
          accessibilityLabel={t('send.retry')}
        >
          <Text style={[styles.retryButtonText, { color: theme.onAccentContainer }]}>
            {t('send.retry')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {c.jobViews.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="file-tray-outline" size={42} color={theme.textSecondary} />
            <Text style={[styles.errorText, { color: theme.textSecondary }]}>
              {t('send.empty')}
            </Text>
          </View>
        ) : (
          <>
            <ContentSection
              views={c.jobViews}
              theme={theme}
              label={`${title} (${c.jobViews.length})`}
            />
            <TargetSection
              targets={c.targets}
              selectedTargetIds={c.selectedTargetIds}
              onToggle={c.toggleTarget}
              theme={theme}
              label={t(c.targetKind === 'server' ? 'send.servers' : 'send.devices')}
              emptyLabel={t(c.targetKind === 'server' ? 'send.noServers' : 'send.noDevices')}
              isLoading={c.isLoadingTargets}
              onRefresh={c.refreshTargets}
            />
          </>
        )}
      </ScrollView>
      <SendFooter c={c} hasFailed={hasFailed} theme={theme} />
    </>
  );
}

function SendFooter({
  c,
  hasFailed,
  theme,
}: {
  c: ReturnType<typeof useShareSendController>;
  hasFailed: boolean;
  theme: ColorScheme;
}) {
  const { t } = useTranslation('share');
  const done = c.isDone && !hasFailed;
  const enabled = done || hasFailed || c.canSend;
  const label = done ? t('send.success') : hasFailed ? t('send.retry') : t('send.sendAll');
  const icon = done ? 'checkmark' : hasFailed ? 'refresh' : 'paper-plane';
  const onPress = done ? c.handleClose : c.sendAll;

  return (
    <View style={[styles.footer, { borderTopColor: theme.separator }]}>
      <Pressable
        onPress={onPress}
        disabled={!enabled || c.isSending}
        android_ripple={{ color: theme.fillSecondary as string }}
        style={[
          styles.sendButton,
          { backgroundColor: enabled ? theme.accent : theme.surfaceHigh },
          (!enabled || c.isSending) && styles.sendButtonDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {c.isSending ? (
          <ActivityIndicator color={theme.onAccent} />
        ) : (
          <Ionicons
            name={icon as never}
            size={20}
            color={enabled ? theme.onAccent : theme.textSecondary}
          />
        )}
        <Text
          style={[styles.sendButtonText, { color: enabled ? theme.onAccent : theme.textSecondary }]}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

function SectionLabel({ theme, label }: { theme: ColorScheme; label: string }) {
  return <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>{label}</Text>;
}

function ContentSection({
  views,
  theme,
  label,
}: {
  views: ShareJobView[];
  theme: ColorScheme;
  label: string;
}) {
  return (
    <>
      <SectionLabel theme={theme} label={label} />
      {views.map((view) => (
        <JobCard key={view.job.id} view={view} theme={theme} />
      ))}
    </>
  );
}

function TargetSection({
  targets,
  selectedTargetIds,
  onToggle,
  theme,
  label,
  emptyLabel,
  isLoading,
  onRefresh,
}: {
  targets: ShareTarget[];
  selectedTargetIds: Set<string>;
  onToggle: (targetId: string) => void;
  theme: ColorScheme;
  label: string;
  emptyLabel: string;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useTranslation('share');
  return (
    <>
      <SectionLabel theme={theme} label={label} />
      {isLoading ? (
        <ActivityIndicator color={theme.accent} style={styles.targetLoading} />
      ) : targets.length === 0 ? (
        <View style={styles.noTargetsBox}>
          <Text style={[styles.noTargets, { color: theme.textSecondary }]}>{emptyLabel}</Text>
          <Pressable
            onPress={() => void onRefresh()}
            android_ripple={{ color: theme.fillSecondary as string }}
            style={[styles.refreshTargetsButton, { backgroundColor: theme.accentContainer }]}
            accessibilityRole="button"
            accessibilityLabel={t('action.refresh', { ns: 'common' })}
          >
            <Ionicons name="refresh" size={18} color={theme.onAccentContainer} />
            <Text style={[styles.refreshTargetsText, { color: theme.onAccentContainer }]}>
              {t('action.refresh', { ns: 'common' })}
            </Text>
          </Pressable>
        </View>
      ) : (
        targets.map((target) => (
          <TargetRow
            key={target.id}
            target={target}
            selected={selectedTargetIds.has(target.id)}
            onToggle={onToggle}
            theme={theme}
          />
        ))
      )}
    </>
  );
}

function JobCard({ view, theme }: { view: ShareJobView; theme: ColorScheme }) {
  const { job } = view;
  return (
    <View style={[styles.card, { backgroundColor: theme.surfaceHigh }]}>
      <View style={styles.cardMain}>
        {job.kind === 'text' ? (
          <View style={styles.textBox}>
            <Text style={[styles.cardName, { color: theme.textPrimary }]} numberOfLines={2}>
              {view.previewText || job.displayName}
            </Text>
            <Text style={[styles.cardDetail, { color: theme.textSecondary }]}>
              {formatBytes(job.byteCount)}
            </Text>
          </View>
        ) : (
          <>
            {job.kind === 'image' ? (
              <Image source={{ uri: job.fileUri }} style={styles.thumbnail} resizeMode="contain" />
            ) : (
              <View style={[styles.fileIconBox, { backgroundColor: theme.accentContainer }]}>
                <Ionicons name="document-outline" size={20} color={theme.onAccentContainer} />
              </View>
            )}
            <View style={styles.cardMeta}>
              <Text style={[styles.cardName, { color: theme.textPrimary }]} numberOfLines={1}>
                {job.displayName}
              </Text>
              <Text style={[styles.cardDetail, { color: theme.textSecondary }]} numberOfLines={1}>
                {job.kind === 'image'
                  ? `${job.mimeType ?? 'image'} · ${formatBytes(job.byteCount)}`
                  : `${job.mimeType ?? ''}${job.mimeType ? ' · ' : ''}${formatBytes(
                      job.byteCount
                    )}`}
              </Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function TargetRow({
  target,
  selected,
  onToggle,
  theme,
}: {
  target: ShareTarget;
  selected: boolean;
  onToggle: (targetId: string) => void;
  theme: ColorScheme;
}) {
  return (
    <Pressable
      onPress={() => onToggle(target.id)}
      android_ripple={{ color: theme.fillSecondary as string }}
      style={[
        styles.targetRow,
        selected && styles.targetRowSelected,
        {
          backgroundColor: selected ? theme.accentContainer : theme.surfaceHigh,
          borderColor: selected ? theme.accent : theme.separator,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <View style={styles.targetText}>
        <Text style={[styles.targetName, { color: theme.textPrimary }]} numberOfLines={1}>
          {target.displayName}
        </Text>
        {target.detail ? (
          <Text style={[styles.targetDetail, { color: theme.textSecondary }]} numberOfLines={1}>
            {target.detail}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={selected ? 'checkbox' : 'square-outline'}
        size={23}
        color={selected ? theme.accent : theme.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  title: { ...m3Type.titleLarge, flex: 1 },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  parsingText: { fontSize: 16, fontWeight: '500' },
  errorText: { fontSize: 15, textAlign: 'center' },
  retryButton: {
    overflow: 'hidden',
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: { fontSize: 14, fontWeight: '600' },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 20, gap: 10 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  sectionLabel: { fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 2 },
  card: { borderRadius: 12, padding: 14 },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  textBox: { flex: 1, gap: 4 },
  thumbnail: { width: 88, height: 88, borderRadius: 8 },
  fileIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMeta: { flex: 1, gap: 4 },
  cardName: { fontSize: 15, fontWeight: '500' },
  cardDetail: { fontSize: 12 },
  noTargets: { fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  noTargetsBox: { alignItems: 'center', gap: 4, paddingBottom: 8 },
  refreshTargetsButton: {
    overflow: 'hidden',
    minHeight: 48,
    borderRadius: 24,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  refreshTargetsText: { fontSize: 14, fontWeight: '600' },
  targetLoading: { paddingVertical: 20 },
  targetRow: {
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    minHeight: 58,
  },
  targetRowSelected: { borderWidth: 2 },
  targetText: { flex: 1, gap: 2 },
  targetName: { fontSize: 15 },
  targetDetail: { fontSize: 12 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16 },
  sendButton: {
    overflow: 'hidden',
    minHeight: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  sendButtonDisabled: { opacity: 0.55 },
  sendButtonText: { fontSize: 16, fontWeight: '600' },
});
