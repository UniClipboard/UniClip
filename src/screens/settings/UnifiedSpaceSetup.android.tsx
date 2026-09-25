/**
 * 空间设备页(Android)。顶级「设备」目的地在直连通道下的主体,也是 `space` 二级页。
 *
 * 布局(M3 Expressive):状态卡(整体状态 + 添加设备)→ 本机 → 其他设备 → 「空间设置」入口。
 * 中继、切换空间、退出空间等低频管理项下沉到 `spaceSettings` 二级页,让设备列表成为页面主体。
 * 未加入空间时整页为居中的空状态,不再套设置卡片。刷新动作挂在所在页面的标题栏右侧。
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgressIndicator,
  Column,
  FilledTonalButton,
  Icon,
  ListItem,
  Row,
  Shape,
  Spacer,
  Surface,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxWidth,
  height as heightModifier,
  padding,
  rotate,
  size,
  testID,
  weight,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { M3IconButton } from '@/components/android/M3IconButton';
import { SpaceDeviceDetail } from '@/components/SpaceDeviceDetail';
import { useSpaceDeviceManagement } from '@/components/useSpaceDeviceManagement';
import { useSpacePageRefresh } from '@/components/useSpacePageRefresh';
import {
  UnifiedSpaceInputError,
  useUnifiedSpaceStore,
  type DeviceTrustDeviceView,
  spaceMaintenanceMessage,
} from '@/features/space';
import { useTheme } from '@/hooks/useTheme';
import { SettingsSectionItem, useSettingsSectionRowColors } from './SettingsSectionItem';
import { SettingsLeadingIcon, type SettingsLeadingIconTone } from './android/SettingsLeadingIcon';

const EMPTY_TITLE_STYLE = {
  fontSize: 26,
  fontWeight: '500',
  letterSpacing: 0,
  textAlign: 'center',
} as const;
const EMPTY_BODY_STYLE = { fontSize: 15, textAlign: 'center' } as const;
const EMPTY_FOOTER_STYLE = { fontSize: 12, textAlign: 'center' } as const;
const HERO_TITLE_STYLE = { fontSize: 20, fontWeight: '500', letterSpacing: 0 } as const;
const HERO_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 28, topEnd: 28, bottomStart: 28, bottomEnd: 28 },
});
const HERO_BADGE_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 22, topEnd: 22, bottomStart: 22, bottomEnd: 22 },
});
const EMPTY_ART_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 40, topEnd: 40, bottomStart: 40, bottomEnd: 40 },
});
const SKELETON_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 8, topEnd: 8, bottomStart: 8, bottomEnd: 8 },
});
const CIRCLE_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 50, topEnd: 50, bottomStart: 50, bottomEnd: 50 },
});

const ICONS = {
  add: require('../../assets/icons/add.xml'),
  alert: require('../../assets/icons/info.xml'),
  check: require('../../assets/icons/check.xml'),
  chevron: require('../../assets/icons/chevron_right.xml'),
  device: require('../../assets/icons/devices.xml'),
  join: require('../../assets/icons/account_circle.xml'),
  phone: require('../../assets/icons/smartphone.xml'),
  settings: require('../../assets/icons/settings.xml'),
  status: require('../../assets/icons/circle.xml'),
};

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError)
    return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

function deviceStatusLabel(
  device: DeviceTrustDeviceView,
  t: (key: string) => string
): string {
  if (device.primaryStatus !== 'usable' && device.primaryStatus !== 'unknown') {
    return t(`space.deviceTrust.status.${device.primaryStatus}`);
  }
  return device.isLocal
    ? t('space.devices.thisDevice')
    : device.reachability === 'online'
    ? t('space.devices.online')
    : t('space.devices.offline');
}

function SpaceDeviceRow({
  device,
  removing,
  onManage,
}: {
  device: DeviceTrustDeviceView;
  removing: boolean;
  onManage: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  const { theme } = useTheme();
  const online = device.isLocal || device.reachability === 'online';
  const informationalStatus =
    device.primaryStatus === 'removalAcknowledgementPending';
  const trustStatus =
    !informationalStatus &&
    device.primaryStatus !== 'usable' &&
    device.primaryStatus !== 'unknown';
  const statusColor = informationalStatus
    ? colors.primary
    : trustStatus
    ? colors.error
    : online
    ? (theme.colors.success as string)
    : colors.outline;
  const iconTone: SettingsLeadingIconTone = trustStatus
    ? 'error'
    : online
    ? 'primary'
    : 'muted';

  return (
    <ListItem
      colors={rowColors}
      modifiers={removing ? [] : [clickable(onManage)]}
    >
      <ListItem.LeadingContent>
        <SettingsLeadingIcon
          source={device.isLocal ? ICONS.phone : ICONS.device}
          tone={iconTone}
        />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText>{device.displayName}</ComposeText>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <Row verticalAlignment="center">
          <Icon source={ICONS.status} size={8} tint={statusColor} />
          <Spacer modifiers={[widthModifier(6)]} />
          <ComposeText color={statusColor}>
            {deviceStatusLabel(device, t)}
          </ComposeText>
        </Row>
      </ListItem.SupportingContent>
      <ListItem.TrailingContent>
        {removing ? (
          <CircularProgressIndicator
            modifiers={[widthModifier(24), heightModifier(24)]}
          />
        ) : (
          <Icon
            source={ICONS.chevron}
            size={20}
            tint={colors.onSurfaceVariant}
            contentDescription={t('space.devices.manageHint')}
          />
        )}
      </ListItem.TrailingContent>
    </ListItem>
  );
}

/** 分组内的纯文本占位行(无本机记录 / 暂无其他设备)。 */
function PlaceholderRow({ label, icon }: { label: string; icon: number }) {
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  return (
    <ListItem colors={rowColors}>
      <ListItem.LeadingContent>
        <SettingsLeadingIcon source={icon} tone="muted" />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText color={colors.onSurfaceVariant}>{label}</ComposeText>
      </ListItem.HeadlineContent>
    </ListItem>
  );
}

function SpaceSettingsRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  return (
    <ListItem
      colors={rowColors}
      modifiers={[testID('space-settings'), clickable(onOpen)]}
    >
      <ListItem.LeadingContent>
        <SettingsLeadingIcon source={ICONS.settings} tone="muted" />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText>{t('space.settings.title')}</ComposeText>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <ComposeText color={colors.onSurfaceVariant}>
          {t('space.settings.summary')}
        </ComposeText>
      </ListItem.SupportingContent>
      <ListItem.TrailingContent>
        <Icon source={ICONS.chevron} size={20} tint={colors.onSurfaceVariant} />
      </ListItem.TrailingContent>
    </ListItem>
  );
}

function SkeletonBar({
  fraction,
  barHeight,
}: {
  fraction: number;
  barHeight: number;
}) {
  const colors = useMaterialColors();
  return (
    <Surface
      color={colors.surfaceContainerHighest}
      shape={SKELETON_SHAPE}
      modifiers={[fillMaxWidth(fraction), heightModifier(barHeight)]}
    />
  );
}

function SkeletonRow() {
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  return (
    <ListItem colors={rowColors}>
      <ListItem.LeadingContent>
        <Surface
          color={colors.surfaceContainerHighest}
          shape={CIRCLE_SHAPE}
          modifiers={[size(40, 40)]}
        />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <SkeletonBar fraction={0.6} barHeight={14} />
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <SkeletonBar fraction={0.4} barHeight={12} />
      </ListItem.SupportingContent>
    </ListItem>
  );
}

export const UnifiedSpaceSetup = memo(function UnifiedSpaceSetup({
  initialDeviceId,
  notificationNavigationRequestId,
}: {
  initialDeviceId?: string;
  notificationNavigationRequestId?: number;
}) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const { theme } = useTheme();
  const navigation = useNavigation<any>();
  const [setupMode, setSetupMode] = useState<AddSyncConnectionMode | null>(
    null
  );
  const pageRefresh = useSpacePageRefresh();
  const refreshError = pageRefresh.error
    ? operationError(pageRefresh.error, t)
    : null;
  const refresh = pageRefresh.refresh;
  const space = useUnifiedSpaceStore();
  const deviceManagement = useSpaceDeviceManagement({
    allowHighImpactActions: true,
  });
  const initialDeviceHandled = useRef<number | null>(null);
  const spaceId = space.spaceId;

  useEffect(() => {
    if (
      notificationNavigationRequestId == null ||
      initialDeviceHandled.current === notificationNavigationRequestId
    )
      return;
    if (!initialDeviceId) {
      initialDeviceHandled.current = notificationNavigationRequestId;
      deviceManagement.closeDevice();
      return;
    }
    if (
      !deviceManagement.devices.some(
        (device) => device.deviceId === initialDeviceId
      )
    )
      return;
    initialDeviceHandled.current = notificationNavigationRequestId;
    deviceManagement.openDevice(initialDeviceId);
  }, [
    deviceManagement.closeDevice,
    deviceManagement.devices,
    deviceManagement.openDevice,
    initialDeviceId,
    notificationNavigationRequestId,
  ]);

  // 刷新放在所在页面(设备目的地 / space 二级页)的标题栏右侧;未加入空间时没有可刷新的设备
  useLayoutEffect(() => {
    if (!spaceId) return;
    navigation.setOptions({
      headerRight: () => (
        <M3IconButton
          icon="refresh"
          accessibilityLabel={t('action.refresh', { ns: 'common' })}
          onPress={() => void refresh()}
          colors={theme.colors}
          testID="space-refresh"
        />
      ),
    });
    return () => navigation.setOptions({ headerRight: undefined });
  }, [navigation, refresh, spaceId, t, theme.colors]);

  const devices = [...deviceManagement.devices].sort((left, right) => {
    const leftRank = left.isLocal ? 0 : left.reachability === 'online' ? 1 : 2;
    const rightRank = right.isLocal
      ? 0
      : right.reachability === 'online'
      ? 1
      : 2;
    return leftRank - rightRank;
  });
  const localDevice = devices.find((device) => device.isLocal) ?? null;
  const otherDevices = devices.filter((device) => !device.isLocal);
  const otherDeviceCount = otherDevices.length;
  const localDeviceName =
    localDevice?.displayName ??
    space.deviceName ??
    t('space.devices.thisDevice');
  const overview = deviceManagement.overview;
  const deviceUpdateInProgress = overview.deviceUpdateInProgress;
  const highImpactActionsDisabled =
    !deviceManagement.highImpactActionsAvailable ||
    deviceManagement.operationInProgress ||
    deviceManagement.overview.hasPendingDecision;
  const syncFailed =
    overview.primaryStatus === 'unverifiable' ||
    overview.primaryStatus === 'decisionRequired';
  const healthy = overview.primaryStatus === 'healthy';
  const isLoading = overview.isLoading;
  const overviewTitle = t(`space.overview.status.${overview.primaryStatus}`);
  const overviewBody =
    refreshError ??
    spaceMaintenanceMessage(overview, t) ??
    t('space.overview.memberCount', { count: overview.memberCount });
  // 状态卡:异常用 error 容器,健康用 primary 容器,其余(更新中 / 维护中)用中性容器
  const heroContainer = syncFailed
    ? colors.errorContainer
    : healthy
    ? colors.primaryContainer
    : colors.surfaceContainerHigh;
  const heroContent = syncFailed
    ? colors.onErrorContainer
    : healthy
    ? colors.onPrimaryContainer
    : colors.onSurface;
  const heroBadgeContainer = syncFailed
    ? colors.error
    : healthy
    ? colors.onPrimaryContainer
    : colors.secondaryContainer;
  const heroBadgeContent = syncFailed
    ? colors.onError
    : healthy
    ? colors.primaryContainer
    : colors.onSecondaryContainer;
  const isInitialLoading =
    !spaceId &&
    !refreshError &&
    (pageRefresh.waiting ||
      space.status === 'idle' ||
      space.status === 'loading');

  const dialogs = (
    <>
      <AddSyncConnectionSheet
        visible={setupMode !== null}
        initialMode={setupMode ?? 'choose'}
        onClose={() => setSetupMode(null)}
        onConnected={() => {
          setSetupMode(null);
          return true;
        }}
      />

      <SpaceDeviceDetail
        device={deviceManagement.selectedDevice}
        canRemove={deviceManagement.canRemoveSelected}
        confirmingRemoval={deviceManagement.confirmingRemoval}
        removing={deviceManagement.removing}
        removeErrorMessage={
          deviceManagement.removeError ? t('space.error.operationFailed') : null
        }
        onClose={deviceManagement.closeDevice}
        onRequestRemove={deviceManagement.requestRemove}
        onCancelRemove={deviceManagement.cancelRemove}
        onConfirmRemove={() => void deviceManagement.confirmRemove()}
        onUpdateThisDevice={() => {
          deviceManagement.closeDevice();
          navigation.navigate('SettingsSub', { section: 'about' });
        }}
      />
    </>
  );

  const content = isInitialLoading ? (
    <SettingsSectionItem variant="grouped" title={t('space.title')}>
      <SkeletonRow key="skeleton-1" />
      <SkeletonRow key="skeleton-2" />
    </SettingsSectionItem>
  ) : !spaceId ? (
    <Column
      horizontalAlignment="center"
      modifiers={[fillMaxWidth(), padding(16, 48, 16, 16)]}
    >
      <Surface
        color={colors.primaryContainer}
        shape={EMPTY_ART_SHAPE}
        modifiers={[size(120, 120), rotate(-6)]}
      >
        <Box contentAlignment="center" modifiers={[size(120, 120), rotate(6)]}>
          <Icon source={ICONS.device} size={56} tint={colors.onPrimaryContainer} />
        </Box>
      </Surface>
      <Spacer modifiers={[heightModifier(28)]} />
      <ComposeText style={EMPTY_TITLE_STYLE}>{t('space.empty.title')}</ComposeText>
      <Spacer modifiers={[heightModifier(8)]} />
      <ComposeText color={colors.onSurfaceVariant} style={EMPTY_BODY_STYLE}>
        {refreshError ?? t('space.empty.body')}
      </ComposeText>
      {refreshError ? (
        <TextButton onClick={refresh}>
          <ComposeText>{t('action.retry', { ns: 'common' })}</ComposeText>
        </TextButton>
      ) : null}
      <Spacer modifiers={[heightModifier(28)]} />
      <Button onClick={() => setSetupMode('create')} modifiers={[fillMaxWidth()]}>
        <Icon source={ICONS.add} size={18} tint={colors.onPrimary} />
        <Spacer modifiers={[widthModifier(8)]} />
        <ComposeText>{t('space.create.title')}</ComposeText>
      </Button>
      <Spacer modifiers={[heightModifier(12)]} />
      <FilledTonalButton onClick={() => setSetupMode('join')} modifiers={[fillMaxWidth()]}>
        <Icon source={ICONS.join} size={18} tint={colors.onSecondaryContainer} />
        <Spacer modifiers={[widthModifier(8)]} />
        <ComposeText>{t('space.join.title')}</ComposeText>
      </FilledTonalButton>
      <Spacer modifiers={[heightModifier(20)]} />
      <ComposeText color={colors.onSurfaceVariant} style={EMPTY_FOOTER_STYLE}>
        {t('space.footer')}
      </ComposeText>
    </Column>
  ) : (
    <Column modifiers={[fillMaxWidth()]}>
      <Surface
        color={heroContainer}
        contentColor={heroContent}
        shape={HERO_SHAPE}
        modifiers={[
          fillMaxWidth(),
          ...(deviceUpdateInProgress
            ? [clickable(() => setSetupMode('join'))]
            : []),
        ]}
      >
        <Column modifiers={[fillMaxWidth(), padding(20, 20, 20, 20)]}>
          <Row verticalAlignment="top" modifiers={[fillMaxWidth()]}>
            <Surface
              color={heroBadgeContainer}
              shape={HERO_BADGE_SHAPE}
              modifiers={[size(44, 44)]}
            >
              <Box contentAlignment="center" modifiers={[size(44, 44)]}>
                {isLoading ? (
                  <CircularProgressIndicator
                    color={heroBadgeContent}
                    modifiers={[widthModifier(22), heightModifier(22)]}
                  />
                ) : (
                  <Icon
                    source={healthy ? ICONS.check : ICONS.alert}
                    size={24}
                    tint={heroBadgeContent}
                  />
                )}
              </Box>
            </Surface>
            <Spacer modifiers={[widthModifier(14)]} />
            <Column modifiers={[weight(1)]}>
              <ComposeText color={heroContent} style={HERO_TITLE_STYLE}>
                {overviewTitle}
              </ComposeText>
              <Spacer modifiers={[heightModifier(2)]} />
              <ComposeText color={heroContent}>{overviewBody}</ComposeText>
            </Column>
            {deviceUpdateInProgress ? (
              <Icon source={ICONS.chevron} size={20} tint={heroContent} />
            ) : null}
          </Row>
          <Spacer modifiers={[heightModifier(16)]} />
          <Row verticalAlignment="center">
            <Button
              onClick={() => setSetupMode('invite')}
              enabled={!highImpactActionsDisabled}
            >
              <Icon source={ICONS.add} size={18} tint={colors.onPrimary} />
              <Spacer modifiers={[widthModifier(8)]} />
              <ComposeText>{t('space.invitation.addAction')}</ComposeText>
            </Button>
            {syncFailed && !isLoading ? (
              <>
                <Spacer modifiers={[widthModifier(8)]} />
                <TextButton onClick={refresh}>
                  <ComposeText color={heroContent}>
                    {t('action.retry', { ns: 'common' })}
                  </ComposeText>
                </TextButton>
              </>
            ) : null}
          </Row>
        </Column>
      </Surface>

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem variant="grouped" title={t('space.devices.thisDevice')}>
        {localDevice ? (
          <SpaceDeviceRow
            key={localDevice.deviceId}
            device={localDevice}
            removing={false}
            onManage={() => deviceManagement.openDevice(localDevice.deviceId)}
          />
        ) : (
          <PlaceholderRow key="local" label={localDeviceName} icon={ICONS.phone} />
        )}
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem
        variant="grouped"
        title={`${t('space.devices.otherTitle')} · ${otherDeviceCount}`}
      >
        {otherDevices.length ? (
          otherDevices.map((device) => (
            <SpaceDeviceRow
              key={device.deviceId}
              device={device}
              removing={deviceManagement.removing}
              onManage={() => deviceManagement.openDevice(device.deviceId)}
            />
          ))
        ) : (
          <PlaceholderRow key="empty" label={t('space.devices.empty')} icon={ICONS.device} />
        )}
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem variant="grouped">
        <SpaceSettingsRow
          key="space-settings"
          onOpen={() => navigation.navigate('SettingsSub', { section: 'spaceSettings' })}
        />
      </SettingsSectionItem>
    </Column>
  );

  // Keep modal ownership stable when joining changes the surrounding space page.
  // Dialogs must follow the content: mounting or unmounting a sheet ahead of it resets the
  // content's Compose state, and every async-loaded Icon blanks for a frame after dismissal.
  return (
    <Column modifiers={[fillMaxWidth()]}>
      {content}
      {dialogs}
    </Column>
  );
});
