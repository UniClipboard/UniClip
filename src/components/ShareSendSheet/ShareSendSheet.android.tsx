import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { AppBottomSheet, AppButton, AppCard, AppProgressIndicator } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { ColorScheme } from '@/theme/colors.types';
import type { UnifiedSpaceDevice } from '@/features/space';
import type { ShareSendSheetProps } from './ShareSendSheet.types';
import { useShareSendController, formatBytes, type ShareJobView } from './useShareSendController';

/**
 * Android 分享弹层:复用 AppBottomSheet(M3 scrim 淡入 + 面板滑升)。
 * 逻辑全在 useShareSendController,两端共享。
 */
export function ShareSendSheet({ visible, onClose }: ShareSendSheetProps) {
  const c = useShareSendController(onClose, visible);
  const { theme } = useTheme();
  const { t } = useTranslation('share');
  const hasFailed = c.jobViews.some((v) => v.sendState === 'failed');

  return (
    <AppBottomSheet visible={visible} onDismiss={onClose} containerColor={theme.colors.surfaceLow}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>{t('send.title')}</Text>
        <HeaderSendButton
          theme={theme.colors}
          done={c.isDone}
          canSend={c.canSend}
          sending={c.isSending}
          hasFailed={hasFailed}
          hasContent={c.jobViews.length > 0}
          onPress={c.isDone && !hasFailed ? c.handleClose : c.sendAll}
        />
      </View>

      <View style={styles.body}>
        {c.phase.kind === 'claiming' ? (
          <View style={styles.centerBox}>
            <AppProgressIndicator color={theme.colors.accent} />
          </View>
        ) : c.phase.kind === 'error' ? (
          <View style={styles.centerBox}>
            <Ionicons name="alert-circle-outline" size={40} color={theme.colors.textSecondary} />
            <Text style={[styles.errorText, { color: theme.colors.textSecondary }]}>
              {c.phase.message}
            </Text>
            <AppButton title={t('send.retry')} onPress={c.handleRetryClaim} variant="tonal" />
          </View>
        ) : c.jobViews.length === 0 ? (
          <View style={styles.centerBox}>
            <Ionicons name="file-tray-outline" size={40} color={theme.colors.textSecondary} />
            <Text style={[styles.errorText, { color: theme.colors.textSecondary }]}>
              {t('send.empty')}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <ContentSection
              views={c.jobViews}
              theme={theme.colors}
              label={`${t('send.title')} (${c.jobViews.length})`}
            />
            <DeviceSection
              devices={c.devices}
              selectedDeviceIds={c.selectedDeviceIds}
              onToggle={c.toggleDevice}
              theme={theme.colors}
              label={t('send.devices')}
              emptyLabel={t('send.noDevices')}
            />
          </ScrollView>
        )}
      </View>
    </AppBottomSheet>
  );
}

/** Header 右上角发送按钮:状态机与 iOS 一致 —— 发送中转圈、失败红色感叹号
 * (点击重试)、全部成功绿色勾(点击关闭)、默认纸飞机(发送)。 */
function HeaderSendButton({
  theme,
  done,
  canSend,
  sending,
  hasFailed,
  hasContent,
  onPress,
}: {
  theme: ColorScheme;
  done: boolean;
  canSend: boolean;
  sending: boolean;
  hasFailed: boolean;
  hasContent: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation('share');
  const enabled = done || hasFailed || canSend;
  const active = enabled && !sending && hasContent;
  const icon = done ? 'checkmark-circle' : hasFailed ? 'alert-circle' : 'paper-plane';
  const color = done ? theme.success : hasFailed ? theme.error : theme.textPrimary;

  return (
    <Pressable
      onPress={onPress}
      disabled={!active}
      style={[styles.closeButton, active ? null : styles.closeButtonDisabled]}
      accessibilityRole="button"
      accessibilityLabel={done ? t('send.done') : hasFailed ? t('send.retry') : t('send.sendAll')}
    >
      {sending ? (
        <AppProgressIndicator color={theme.textSecondary} />
      ) : (
        <Ionicons name={icon as never} size={22} color={color} />
      )}
    </Pressable>
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
    <AppCard containerColor={theme.surfaceHigh} elevation={0} fullWidth>
      <View style={styles.card}>
        <View style={styles.cardMain}>
          {job.kind === 'text' ? (
            <View style={styles.textBox}>
              <Text style={[styles.cardName, { color: theme.textPrimary }]} numberOfLines={1}>
                {view.previewText || job.displayName}
              </Text>
              <Text style={[styles.cardDetail, { color: theme.textSecondary }]} numberOfLines={1}>
                {formatBytes(job.byteCount)}
              </Text>
            </View>
          ) : (
            <>
              {job.kind === 'image' ? (
                <Image
                  source={{ uri: job.fileUri }}
                  style={styles.thumbnail}
                  resizeMode="contain"
                />
              ) : (
                <View style={[styles.fileIconBox, { backgroundColor: theme.accentContainer }]}>
                  <Ionicons name="document-outline" size={18} color={theme.onAccentContainer} />
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
    </AppCard>
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
  const { t } = useTranslation('settingsSync');
  const statusColor = device.online ? theme.success : theme.textDisabled;

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
      <View style={styles.deviceLeft}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <View style={styles.deviceMeta}>
          <Text style={[styles.deviceName, { color: theme.textPrimary }]} numberOfLines={1}>
            {device.displayName}
          </Text>
          <Text style={[styles.deviceStatus, { color: statusColor }]}>
            {t(device.online ? 'space.devices.online' : 'space.devices.offline')}
          </Text>
        </View>
      </View>
      <Ionicons
        name={selected ? 'checkbox' : 'square-outline'}
        size={22}
        color={selected ? theme.accent : theme.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 18, fontWeight: '600' },
  closeButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  closeButtonDisabled: { opacity: 0.45 },
  body: { flex: 1 },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  errorText: { fontSize: 15, textAlign: 'center' },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
    opacity: 0.8,
  },
  card: { gap: 10 },
  cardMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  textBox: { flex: 1, gap: 2 },
  thumbnail: { width: 80, height: 80, borderRadius: 8 },
  fileIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMeta: { flex: 1, justifyContent: 'center', gap: 2 },
  cardName: { fontSize: 15, fontWeight: '500' },
  cardDetail: { fontSize: 12 },
  noDevices: { fontSize: 14, textAlign: 'center', paddingVertical: 16 },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    minHeight: 56,
  },
  deviceRowSelected: { borderWidth: 2 },
  deviceLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  deviceMeta: { flex: 1, gap: 1 },
  deviceName: { fontSize: 15 },
  deviceStatus: { fontSize: 12 },
});
