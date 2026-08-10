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
import type { UnifiedSpaceDevice } from '@/features/space';
import { useShareSheetStore } from '@/stores/shareSheetStore';
import type { ShareSendSheetProps } from './ShareSendSheet.types';
import { useShareSendController, formatBytes, type ShareJobView } from './useShareSendController';

/** Android 外部分享独立页面。解析与发送都在同一全屏页面完成。 */
export function ShareSendSheet({ visible, onClose }: ShareSendSheetProps) {
  const isParsing = useShareSheetStore((state) => state.isParsing);
  const c = useShareSendController(onClose, visible && !isParsing);
  const { theme } = useTheme();
  const { t } = useTranslation('share');
  const insets = useSafeAreaInsets();

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
        <PageHeader title={t('send.title')} onClose={onClose} theme={theme.colors} />
        {isParsing ? <ParsingState /> : <ShareBody c={c} theme={theme.colors} />}
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
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onClose}
        style={styles.iconButton}
        accessibilityRole="button"
        accessibilityLabel={t('action.close', { ns: 'common' })}
      >
        <Ionicons name="close" size={25} color={theme.textPrimary} />
      </Pressable>
      <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.iconButton} />
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
}: {
  c: ReturnType<typeof useShareSendController>;
  theme: ColorScheme;
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
              label={`${t('send.title')} (${c.jobViews.length})`}
            />
            <DeviceSection
              devices={c.devices}
              selectedDeviceIds={c.selectedDeviceIds}
              onToggle={c.toggleDevice}
              theme={theme}
              label={t('send.devices')}
              emptyLabel={t('send.noDevices')}
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

function DeviceSection({
  devices,
  selectedDeviceIds,
  onToggle,
  theme,
  label,
  emptyLabel,
}: {
  devices: UnifiedSpaceDevice[];
  selectedDeviceIds: Set<string>;
  onToggle: (deviceId: string) => void;
  theme: ColorScheme;
  label: string;
  emptyLabel: string;
}) {
  return (
    <>
      <SectionLabel theme={theme} label={label} />
      {devices.length === 0 ? (
        <Text style={[styles.noDevices, { color: theme.textSecondary }]}>{emptyLabel}</Text>
      ) : (
        devices.map((device) => (
          <DeviceRow
            key={device.deviceId}
            device={device}
            selected={selectedDeviceIds.has(device.deviceId)}
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

function DeviceRow({
  device,
  selected,
  onToggle,
  theme,
}: {
  device: UnifiedSpaceDevice;
  selected: boolean;
  onToggle: (deviceId: string) => void;
  theme: ColorScheme;
}) {
  return (
    <Pressable
      onPress={() => onToggle(device.deviceId)}
      style={[
        styles.deviceRow,
        selected && styles.deviceRowSelected,
        {
          backgroundColor: selected ? theme.accentContainer : theme.surfaceHigh,
          borderColor: selected ? theme.accent : theme.separator,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.deviceName, { color: theme.textPrimary }]} numberOfLines={1}>
        {device.displayName}
      </Text>
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
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  parsingText: { fontSize: 16, fontWeight: '500' },
  errorText: { fontSize: 15, textAlign: 'center' },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
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
  noDevices: { fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    minHeight: 58,
  },
  deviceRowSelected: { borderWidth: 2 },
  deviceName: { flex: 1, fontSize: 15 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16 },
  sendButton: {
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
