import { memo, useCallback, useEffect, useRef, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { SpaceDeviceDetail } from '@/components/SpaceDeviceDetail';
import { SpaceInvitationSheet } from '@/components/SpaceInvitationSheet';
import { useSpaceDeviceManagement } from '@/components/useSpaceDeviceManagement';
import {
  getUnifiedSpaceService,
  UnifiedSpaceInputError,
  useUnifiedSpaceStore,
  type DeviceTrustDeviceView,
} from '@/features/space';
import { useTheme } from '@/hooks/useTheme';
import { CustomRelaySection } from './CustomRelaySection';
import { SettingsSectionItem } from './SettingsSectionItem';

type PendingOperation = 'leave' | null;

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

function deviceStatusLabel(device: DeviceTrustDeviceView, t: (key: string) => string): string {
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
  manageable,
  onManage,
}: {
  device: DeviceTrustDeviceView;
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
          <ComposeText color={statusColor}>{deviceStatusLabel(device, t)}</ComposeText>
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
  const [setupMode, setSetupMode] = useState<AddSyncConnectionMode | null>(null);
  const [pending, setPending] = useState<PendingOperation>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [spaceOperationError, setSpaceOperationError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showInvitation, setShowInvitation] = useState(false);
  const space = useUnifiedSpaceStore();
  const deviceManagement = useSpaceDeviceManagement({ allowHighImpactActions: true });
  const initialDeviceHandled = useRef<number | null>(null);

  const refresh = useCallback(() => {
    setRefreshError(null);
    void getUnifiedSpaceService()
      .refresh()
      .catch((cause) => setRefreshError(operationError(cause, t)));
  }, [t]);

  useEffect(() => refresh(), [refresh]);

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
    if (!deviceManagement.devices.some((device) => device.deviceId === initialDeviceId)) return;
    initialDeviceHandled.current = notificationNavigationRequestId;
    deviceManagement.openDevice(initialDeviceId);
  }, [
    deviceManagement.closeDevice,
    deviceManagement.devices,
    deviceManagement.openDevice,
    initialDeviceId,
    notificationNavigationRequestId,
  ]);

  // 操作进行中拦截返回键,避免中途离开页面导致状态不一致(与 iOS handleBack 对齐)
  useEffect(() => {
    if (!pending) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [pending]);

  const leaveSpace = async () => {
    if (pending || highImpactActionsDisabled) return;
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
  const devices = [...deviceManagement.devices].sort((left, right) => {
    const leftRank = left.isLocal ? 0 : left.reachability === 'online' ? 1 : 2;
    const rightRank = right.isLocal ? 0 : right.reachability === 'online' ? 1 : 2;
    return leftRank - rightRank;
  });
  const localDevice = devices.find((device) => device.isLocal) ?? null;
  const otherDevices = devices.filter((device) => !device.isLocal);
  const otherDeviceCount = otherDevices.length;
  const localDeviceName =
    localDevice?.displayName ?? space.deviceName ?? t('space.devices.thisDevice');
  const overview = deviceManagement.overview;
  const highImpactActionsDisabled =
    !deviceManagement.highImpactActionsAvailable ||
    deviceManagement.operationInProgress ||
    deviceManagement.overview.hasPendingDecision;
  const leaveSpaceDisabled = pending !== null || deviceManagement.operationInProgress;
  const syncFailed =
    overview.primaryStatus === 'unverifiable' || overview.primaryStatus === 'decisionRequired';
  const isRefreshing = overview.isRefreshing;
  const overviewTitle = t(`space.overview.status.${overview.primaryStatus}`);
  const overviewBody =
    refreshError ?? t('space.overview.memberCount', { count: overview.memberCount });
  const overviewColor = syncFailed
    ? colors.error
    : overview.primaryStatus === 'healthy'
    ? theme.colors.success
    : overview.primaryStatus === 'updateRequired'
    ? colors.primary
    : colors.outline;
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

      <SpaceDeviceDetail
        device={deviceManagement.selectedDevice}
        canRemove={deviceManagement.canRemoveSelected}
        confirmingRemoval={deviceManagement.confirmingRemoval}
        removing={deviceManagement.removing}
        removeErrorMessage={deviceManagement.removeError ? t('space.error.operationFailed') : null}
        onClose={deviceManagement.closeDevice}
        onRequestRemove={deviceManagement.requestRemove}
        onCancelRemove={deviceManagement.cancelRemove}
        onConfirmRemove={() => void deviceManagement.confirmRemove()}
        onUpdateThisDevice={() => {
          deviceManagement.closeDevice();
          navigation.navigate('SettingsSub', { section: 'about' });
        }}
      />

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
            ) : null}
          </Row>
          <Spacer modifiers={[heightModifier(16)]} />
          {syncFailed && !isRefreshing ? (
            <TextButton onClick={refresh} modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('action.retry', { ns: 'common' })}</ComposeText>
            </TextButton>
          ) : null}
          <Button
            onClick={() => setShowInvitation(true)}
            enabled={!highImpactActionsDisabled}
            modifiers={[fillMaxWidth()]}
          >
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
            removing={false}
            manageable
            onManage={() => deviceManagement.openDevice(localDevice.deviceId)}
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
      <SettingsSectionItem title={`${t('space.devices.otherTitle')} (${otherDeviceCount})`}>
        {otherDevices.length ? (
          <>
            {otherDevices.map((device, index) => (
              <Column key={device.deviceId} modifiers={[fillMaxWidth()]}>
                {index > 0 ? <HorizontalDivider /> : null}
                <SpaceDeviceRow
                  device={device}
                  removing={deviceManagement.removing}
                  manageable
                  onManage={() => deviceManagement.openDevice(device.deviceId)}
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
      <Spacer modifiers={[heightModifier(16)]} />
      <CustomRelaySection />

      <Spacer modifiers={[heightModifier(16)]} />
      <SettingsSectionItem
        title={t('space.manage.title')}
        footer={
          highImpactActionsDisabled ? t('space.switch.unavailable') : t('space.switch.description')
        }
      >
        <ListItem
          modifiers={
            highImpactActionsDisabled ? undefined : [clickable(() => setSetupMode('switch'))]
          }
        >
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
        <ListItem
          modifiers={leaveSpaceDisabled ? undefined : [clickable(() => setConfirmLeave(true))]}
        >
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
