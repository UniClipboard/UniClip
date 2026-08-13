import { memo, useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import {
  AlertDialog,
  Button,
  CircularProgressIndicator,
  Column,
  FilledTonalButton,
  HorizontalDivider,
  Icon,
  ListItem,
  ModalBottomSheet,
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
  size,
  weight,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { SpaceInvitationSheet } from '@/components/SpaceInvitationSheet';
import {
  buildDeviceTrustDeviceViews,
  getUnifiedSpaceService,
  UnifiedSpaceInputError,
  useUnifiedSpaceStore,
  type DeviceTrustDeviceView,
} from '@/features/space';
import { useTheme } from '@/hooks/useTheme';
import { CustomRelaySection } from './CustomRelaySection';
import { SettingsSectionItem } from './SettingsSectionItem';

type PendingOperation = 'leave' | `remove:${string}` | null;

const EMPTY_TITLE_STYLE = { fontSize: 22, fontWeight: '600', letterSpacing: 0 } as const;
const EMPTY_BODY_STYLE = { textAlign: 'center' } as const;
const HERO_TITLE_STYLE = { fontSize: 16, fontWeight: '600' } as const;
const HERO_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 28, topEnd: 28, bottomStart: 28, bottomEnd: 28 },
});
const CIRCLE_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 50, topEnd: 50, bottomStart: 50, bottomEnd: 50 },
});

const ICONS = {
  add: require('../../assets/icons/add.xml'),
  chevron: require('../../assets/icons/chevron_right.xml'),
  delete: require('../../assets/icons/delete.xml'),
  device: require('../../assets/icons/account_circle.xml'),
  space: require('../../assets/icons/groups.xml'),
  status: require('../../assets/icons/circle.xml'),
};

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

function deviceStatusLabel(
  device: DeviceTrustDeviceView,
  waitingForConvergence: boolean,
  t: (key: string) => string
): string {
  if (device.primaryStatus !== 'usable' && device.primaryStatus !== 'unknown') {
    return t(`space.deviceTrust.status.${device.primaryStatus}`);
  }
  const base = device.isLocal
    ? t('space.devices.thisDevice')
    : device.reachability === 'online'
    ? t('space.devices.online')
    : t('space.devices.offline');
  return waitingForConvergence ? `${base} · ${t('space.convergence.pendingDevice')}` : base;
}

function SpaceDeviceRow({
  device,
  waitingForConvergence,
  removing,
  manageable,
  onManage,
}: {
  device: DeviceTrustDeviceView;
  waitingForConvergence: boolean;
  removing: boolean;
  manageable: boolean;
  onManage: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const { theme } = useTheme();
  const online = device.isLocal || device.reachability === 'online';
  const trustStatus = device.primaryStatus !== 'usable' && device.primaryStatus !== 'unknown';
  const statusColor = trustStatus
    ? colors.error
    : online
    ? (theme.colors.success as string)
    : colors.outline;
  const modifiers = manageable && !removing ? [clickable(onManage)] : [];

  return (
    <ListItem modifiers={modifiers}>
      <ListItem.LeadingContent>
        <Icon source={ICONS.device} size={28} tint={colors.primary} />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText>{device.displayName}</ComposeText>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <Row verticalAlignment="center">
          <Icon source={ICONS.status} size={8} tint={statusColor} />
          <Spacer modifiers={[widthModifier(6)]} />
          <ComposeText color={statusColor}>
            {deviceStatusLabel(device, waitingForConvergence, t)}
          </ComposeText>
        </Row>
      </ListItem.SupportingContent>
      {manageable ? (
        <ListItem.TrailingContent>
          {removing ? (
            <CircularProgressIndicator modifiers={[widthModifier(24), heightModifier(24)]} />
          ) : (
            <Icon
              source={ICONS.chevron}
              size={20}
              tint={colors.onSurfaceVariant}
              contentDescription={t('space.devices.manageHint')}
            />
          )}
        </ListItem.TrailingContent>
      ) : null}
    </ListItem>
  );
}

function SkeletonBar({ fraction, barHeight }: { fraction: number; barHeight: number }) {
  const colors = useMaterialColors();
  return (
    <Surface
      color={colors.surfaceContainerHigh}
      shape={HERO_SHAPE}
      modifiers={[fillMaxWidth(fraction), heightModifier(barHeight)]}
    />
  );
}

function SkeletonRow() {
  const colors = useMaterialColors();
  return (
    <ListItem>
      <ListItem.LeadingContent>
        <Surface
          color={colors.surfaceContainerHigh}
          shape={CIRCLE_SHAPE}
          modifiers={[size(30, 30)]}
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

export const UnifiedSpaceSetup = memo(function UnifiedSpaceSetup() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const { theme } = useTheme();
  const [setupMode, setSetupMode] = useState<AddSyncConnectionMode | null>(null);
  const [pending, setPending] = useState<PendingOperation>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [deviceOperationError, setDeviceOperationError] = useState<string | null>(null);
  const [spaceOperationError, setSpaceOperationError] = useState<string | null>(null);
  const [manageDeviceId, setManageDeviceId] = useState<string | null>(null);
  const [removeDeviceId, setRemoveDeviceId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showInvitation, setShowInvitation] = useState(false);
  const space = useUnifiedSpaceStore();

  const refresh = useCallback(() => {
    setRefreshError(null);
    void getUnifiedSpaceService()
      .refresh()
      .catch((cause) => setRefreshError(operationError(cause, t)));
  }, [t]);

  useEffect(() => refresh(), [refresh]);

  // 操作进行中拦截返回键,避免中途离开页面导致状态不一致(与 iOS handleBack 对齐)
  useEffect(() => {
    if (!pending) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [pending]);

  const removeDevice = async () => {
    if (!removeDeviceId || pending) return;
    const deviceId = removeDeviceId;
    setRemoveDeviceId(null);
    setPending(`remove:${deviceId}`);
    setDeviceOperationError(null);
    try {
      await getUnifiedSpaceService().removeMember(deviceId);
    } catch (cause) {
      setDeviceOperationError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const leaveSpace = async () => {
    if (pending) return;
    setConfirmLeave(false);
    setPending('leave');
    setSpaceOperationError(null);
    try {
      await getUnifiedSpaceService().leaveSpace();
    } catch (cause) {
      setSpaceOperationError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const spaceId = space.spaceId;
  const workspaceConvergence = space.workspaceConvergence;
  const waitingMemberIds = new Set(workspaceConvergence?.pendingRemovalDecisionDeviceIds ?? []);
  const rosterDeviceIds = new Set(space.devices.map((device) => device.deviceId));
  const devices = buildDeviceTrustDeviceViews(space.deviceTrust, space.devices).sort(
    (left, right) => {
      const leftRank = left.isLocal ? 0 : left.reachability === 'online' ? 1 : 2;
      const rightRank = right.isLocal ? 0 : right.reachability === 'online' ? 1 : 2;
      return leftRank - rightRank;
    }
  );
  const localDevice = devices.find((device) => device.isLocal) ?? null;
  const otherDevices = devices.filter((device) => !device.isLocal);
  const otherDeviceCount = otherDevices.length;
  const onlineCount = otherDevices.filter((device) => device.reachability === 'online').length;
  const offlineCount = otherDeviceCount - onlineCount;
  const hasOnlineDevice = onlineCount > 0;
  const localDeviceName =
    localDevice?.displayName ?? space.deviceName ?? t('space.devices.thisDevice');
  const manageDevice = manageDeviceId
    ? devices.find(
        (device) => device.deviceId === manageDeviceId && rosterDeviceIds.has(device.deviceId)
      ) ?? null
    : null;
  const syncFailed = space.deviceListRefreshStatus === 'failed' || Boolean(refreshError);
  const isRefreshing = space.deviceListRefreshStatus === 'refreshing';
  const overviewTitle = syncFailed
    ? t('space.overview.statusUnavailable')
    : hasOnlineDevice
    ? t('space.overview.devicesAvailable')
    : otherDeviceCount
    ? t('space.overview.noDevicesOnline')
    : t('space.overview.noOtherDevices');
  const overviewBody = syncFailed
    ? refreshError ?? t('space.devices.refreshFailed')
    : hasOnlineDevice
    ? t('space.overview.deviceSummary', { online: onlineCount, offline: offlineCount })
    : otherDeviceCount
    ? t('space.overview.otherDevicesOffline', { count: otherDeviceCount })
    : t('space.devices.empty');
  const overviewColor = syncFailed
    ? colors.error
    : hasOnlineDevice
    ? theme.colors.success
    : colors.outline;
  const convergenceFooter = !workspaceConvergence
    ? undefined
    : workspaceConvergence.phase === 'complete'
    ? t('space.convergence.complete')
    : workspaceConvergence.phase === 'recoveryRequired'
    ? t('space.convergence.recoveryRequired')
    : t('space.convergence.waiting');
  const isInitialLoading =
    !spaceId && !pending && (space.status === 'idle' || space.status === 'loading');

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

      <SpaceInvitationSheet visible={showInvitation} onClose={() => setShowInvitation(false)} />

      {manageDevice ? (
        <ModalBottomSheet onDismissRequest={() => setManageDeviceId(null)}>
          <Column modifiers={[fillMaxWidth(), padding(24, 8, 24, 24)]}>
            <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(0, 12, 0, 4)]}>
              <Icon source={ICONS.device} size={40} tint={colors.primary} />
              <Spacer modifiers={[widthModifier(16)]} />
              <Column>
                <ComposeText style={HERO_TITLE_STYLE}>{manageDevice.displayName}</ComposeText>
                <ComposeText color={colors.onSurfaceVariant}>
                  {deviceStatusLabel(manageDevice, waitingMemberIds.has(manageDevice.deviceId), t)}
                  {' · '}
                  {t('space.devices.idLabel', { id: manageDevice.deviceId.slice(0, 8) })}
                </ComposeText>
              </Column>
            </Row>
            <Spacer modifiers={[heightModifier(12)]} />
            <HorizontalDivider color={colors.outlineVariant} />
            <ListItem
              modifiers={[
                clickable(() => {
                  const deviceId = manageDevice.deviceId;
                  setManageDeviceId(null);
                  setRemoveDeviceId(deviceId);
                }),
              ]}
            >
              <ListItem.LeadingContent>
                <Icon source={ICONS.delete} size={24} tint={colors.error} />
              </ListItem.LeadingContent>
              <ListItem.HeadlineContent>
                <ComposeText color={colors.error}>{t('space.devices.remove')}</ComposeText>
              </ListItem.HeadlineContent>
            </ListItem>
          </Column>
        </ModalBottomSheet>
      ) : null}

      {removeDeviceId ? (
        <AlertDialog onDismissRequest={() => setRemoveDeviceId(null)}>
          <AlertDialog.Title>
            <ComposeText>{t('space.devices.remove')}</ComposeText>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <ComposeText>{t('space.devices.removeConfirm')}</ComposeText>
          </AlertDialog.Text>
          <AlertDialog.ConfirmButton>
            <TextButton onClick={() => void removeDevice()}>
              <ComposeText>{t('space.devices.remove')}</ComposeText>
            </TextButton>
          </AlertDialog.ConfirmButton>
          <AlertDialog.DismissButton>
            <TextButton onClick={() => setRemoveDeviceId(null)}>
              <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
            </TextButton>
          </AlertDialog.DismissButton>
        </AlertDialog>
      ) : null}

      {confirmLeave ? (
        <AlertDialog onDismissRequest={() => setConfirmLeave(false)}>
          <AlertDialog.Title>
            <ComposeText>{t('space.leave.action')}</ComposeText>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <ComposeText>{t('space.leave.confirm')}</ComposeText>
          </AlertDialog.Text>
          <AlertDialog.ConfirmButton>
            <TextButton onClick={() => void leaveSpace()}>
              <ComposeText>{t('space.leave.action')}</ComposeText>
            </TextButton>
          </AlertDialog.ConfirmButton>
          <AlertDialog.DismissButton>
            <TextButton onClick={() => setConfirmLeave(false)}>
              <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
            </TextButton>
          </AlertDialog.DismissButton>
        </AlertDialog>
      ) : null}
    </>
  );

  if (isInitialLoading) {
    return (
      <SettingsSectionItem title={t('space.title')} dialogs={dialogs}>
        <SkeletonRow />
        <SkeletonRow />
      </SettingsSectionItem>
    );
  }

  if (!spaceId) {
    return (
      <SettingsSectionItem title={t('space.title')} footer={t('space.footer')} dialogs={dialogs}>
        <Column horizontalAlignment="center" modifiers={[fillMaxWidth(), padding(24, 28, 24, 28)]}>
          <Surface color={colors.surfaceContainerHighest} shape={CIRCLE_SHAPE}>
            <Column modifiers={[padding(24, 24, 24, 24)]}>
              <Icon source={ICONS.space} size={48} tint={colors.primary} />
            </Column>
          </Surface>
          <Spacer modifiers={[heightModifier(16)]} />
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
          <Spacer modifiers={[heightModifier(24)]} />
          <Button onClick={() => setSetupMode('create')} modifiers={[fillMaxWidth()]}>
            <Icon source={ICONS.space} size={18} tint={colors.onPrimary} />
            <Spacer modifiers={[widthModifier(8)]} />
            <ComposeText>{t('space.create.title')}</ComposeText>
          </Button>
          <Spacer modifiers={[heightModifier(10)]} />
          <FilledTonalButton onClick={() => setSetupMode('join')} modifiers={[fillMaxWidth()]}>
            <Icon source={ICONS.device} size={18} tint={colors.onSecondaryContainer} />
            <Spacer modifiers={[widthModifier(8)]} />
            <ComposeText>{t('space.join.title')}</ComposeText>
          </FilledTonalButton>
        </Column>
      </SettingsSectionItem>
    );
  }

  return (
    <Column modifiers={[fillMaxWidth()]}>
      {dialogs}

      <Surface
        color={syncFailed ? colors.errorContainer : colors.surfaceContainerHigh}
        shape={HERO_SHAPE}
        modifiers={[fillMaxWidth()]}
      >
        <Column modifiers={[fillMaxWidth(), padding(20, 16, 20, 20)]}>
          <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
            <Icon source={ICONS.status} size={10} tint={overviewColor} />
            <Spacer modifiers={[widthModifier(10)]} />
            <Column modifiers={[weight(1)]}>
              <ComposeText
                color={syncFailed ? colors.onErrorContainer : undefined}
                style={HERO_TITLE_STYLE}
              >
                {overviewTitle}
              </ComposeText>
              <ComposeText color={syncFailed ? colors.onErrorContainer : colors.onSurfaceVariant}>
                {overviewBody}
              </ComposeText>
            </Column>
            {isRefreshing ? (
              <CircularProgressIndicator modifiers={[widthModifier(24), heightModifier(24)]} />
            ) : (
              <TextButton onClick={refresh}>
                <ComposeText>{t('action.retry', { ns: 'common' })}</ComposeText>
              </TextButton>
            )}
          </Row>
          <Spacer modifiers={[heightModifier(16)]} />
          <Button onClick={() => setShowInvitation(true)} modifiers={[fillMaxWidth()]}>
            <Icon source={ICONS.add} size={18} tint={colors.onPrimary} />
            <Spacer modifiers={[widthModifier(8)]} />
            <ComposeText>{t('space.invitation.addAction')}</ComposeText>
          </Button>
        </Column>
      </Surface>

      <Spacer modifiers={[heightModifier(16)]} />
      <SettingsSectionItem title={t('space.devices.thisDevice')}>
        {localDevice ? (
          <SpaceDeviceRow
            device={localDevice}
            waitingForConvergence={waitingMemberIds.has(localDevice.deviceId)}
            removing={false}
            manageable={false}
            onManage={() => undefined}
          />
        ) : (
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{localDeviceName}</ComposeText>
            </ListItem.HeadlineContent>
          </ListItem>
        )}
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(16)]} />
      <SettingsSectionItem
        title={`${t('space.devices.otherTitle')} (${otherDeviceCount})`}
        footer={convergenceFooter}
      >
        {otherDevices.length ? (
          <>
            {otherDevices.map((device, index) => (
              <Column key={device.deviceId} modifiers={[fillMaxWidth()]}>
                {index > 0 ? <HorizontalDivider /> : null}
                <SpaceDeviceRow
                  device={device}
                  waitingForConvergence={waitingMemberIds.has(device.deviceId)}
                  removing={pending === `remove:${device.deviceId}`}
                  manageable={rosterDeviceIds.has(device.deviceId)}
                  onManage={() => setManageDeviceId(device.deviceId)}
                />
              </Column>
            ))}
          </>
        ) : (
          <ListItem>
            <ListItem.LeadingContent>
              <Icon source={ICONS.device} size={24} tint={colors.onSurfaceVariant} />
            </ListItem.LeadingContent>
            <ListItem.HeadlineContent>
              <ComposeText>{t('space.devices.empty')}</ComposeText>
            </ListItem.HeadlineContent>
          </ListItem>
        )}
      </SettingsSectionItem>
      {deviceOperationError ? (
        <>
          <Spacer modifiers={[heightModifier(6)]} />
          <ComposeText color={colors.error}>{deviceOperationError}</ComposeText>
        </>
      ) : null}

      <Spacer modifiers={[heightModifier(16)]} />
      <CustomRelaySection />

      <Spacer modifiers={[heightModifier(16)]} />
      <SettingsSectionItem title={t('space.manage.title')} footer={t('space.switch.description')}>
        <ListItem modifiers={[clickable(() => setSetupMode('switch'))]}>
          <ListItem.LeadingContent>
            <Icon source={ICONS.space} size={24} tint={colors.primary} />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <ComposeText>{t('space.switch.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.TrailingContent>
            <Icon source={ICONS.chevron} size={20} tint={colors.onSurfaceVariant} />
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(16)]} />
      <SettingsSectionItem title={t('space.danger.title')} footer={t('space.leave.confirm')}>
        <ListItem modifiers={[clickable(() => setConfirmLeave(true))]}>
          <ListItem.LeadingContent>
            <Icon source={ICONS.delete} size={24} tint={colors.error} />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <ComposeText color={colors.error}>{t('space.leave.action')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.TrailingContent>
            {pending === 'leave' ? (
              <CircularProgressIndicator modifiers={[widthModifier(24), heightModifier(24)]} />
            ) : null}
          </ListItem.TrailingContent>
        </ListItem>
        {spaceOperationError ? (
          <>
            <HorizontalDivider />
            <Column modifiers={[padding(16, 12, 16, 12)]}>
              <ComposeText color={colors.error}>{spaceOperationError}</ComposeText>
            </Column>
          </>
        ) : null}
      </SettingsSectionItem>
    </Column>
  );
});
