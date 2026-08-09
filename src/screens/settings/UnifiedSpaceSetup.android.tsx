import { memo, useEffect, useRef, useState } from 'react';
import {
  AlertDialog,
  Button,
  CircularProgressIndicator,
  Column,
  HorizontalDivider,
  Icon,
  IconButton,
  ListItem,
  OutlinedButton,
  Row,
  Spacer,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxWidth,
  height as heightModifier,
  padding,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { SpaceInvitationSheet } from '@/components/SpaceInvitationSheet';
import { getUnifiedSpaceService, UnifiedSpaceInputError } from '@/features/space';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore, type UnifiedSpaceDevice } from '@/features/space';
import { CustomRelaySection } from './CustomRelaySection';
import { SettingsSectionItem } from './SettingsSectionItem';

type PendingOperation = 'leave' | `remove:${string}` | `recover:${string}` | null;

const EMPTY_TITLE_STYLE = { fontSize: 22, fontWeight: '600', letterSpacing: 0 } as const;
const EMPTY_BODY_STYLE = { textAlign: 'center' } as const;

const ICONS = {
  add: require('../../assets/icons/add.xml'),
  chevron: require('../../assets/icons/chevron_right.xml'),
  device: require('../../assets/icons/account_circle.xml'),
  ready: require('../../assets/icons/check_circle.xml'),
  space: require('../../assets/icons/groups.xml'),
  status: require('../../assets/icons/circle.xml'),
};

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

function SpaceDeviceRow({
  device,
  removing,
  onManage,
}: {
  device: UnifiedSpaceDevice;
  removing: boolean;
  onManage: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const online = device.isLocal || device.online;
  const statusColor = online ? colors.primary : colors.outline;
  const modifiers = !device.isLocal && !removing ? [clickable(onManage)] : [];

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
            {t(
              device.isLocal
                ? 'space.devices.thisDevice'
                : online
                ? 'space.devices.online'
                : 'space.devices.offline'
            )}
          </ComposeText>
        </Row>
      </ListItem.SupportingContent>
      {!device.isLocal ? (
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

export const UnifiedSpaceSetup = memo(function UnifiedSpaceSetup() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const [setupMode, setSetupMode] = useState<AddSyncConnectionMode | null>(null);
  const [pending, setPending] = useState<PendingOperation>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeDeviceId, setRemoveDeviceId] = useState<string | null>(null);
  const [permanentlyLostDeviceId, setPermanentlyLostDeviceId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showInvitation, setShowInvitation] = useState(false);
  const space = useUnifiedSpaceStore();
  const refreshRevision = useUnifiedEngineStore((state) => state.refreshRevision);
  const hasLoadedSpace = useRef(false);

  useEffect(() => {
    void getUnifiedSpaceService()
      .refresh()
      .catch((cause) => setError(operationError(cause, t)))
      .finally(() => {
        hasLoadedSpace.current = true;
      });
  }, [t]);

  useEffect(() => {
    if (!hasLoadedSpace.current) return;
    void getUnifiedSpaceService()
      .refreshDevices()
      .catch((cause) => setError(operationError(cause, t)));
  }, [refreshRevision, t]);

  const removeDevice = async () => {
    if (!removeDeviceId || pending) return;
    const deviceId = removeDeviceId;
    setRemoveDeviceId(null);
    setPending(`remove:${deviceId}`);
    setError(null);
    try {
      await getUnifiedSpaceService().removeMember(deviceId);
    } catch (cause) {
      setError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const continueMemberRemoval = async () => {
    const deviceId = permanentlyLostDeviceId;
    const revocationId = space.memberRemoval?.revocationId;
    if (!deviceId || !revocationId || pending) return;

    setPermanentlyLostDeviceId(null);
    setPending(`recover:${deviceId}`);
    setError(null);
    try {
      await getUnifiedSpaceService().continueMemberRevocation(revocationId, [deviceId]);
    } catch (cause) {
      setError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const leaveSpace = async () => {
    if (pending) return;
    setConfirmLeave(false);
    setPending('leave');
    setError(null);
    try {
      await getUnifiedSpaceService().leaveSpace();
    } catch (cause) {
      setError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const spaceId = space.spaceId;
  const memberRemoval = space.memberRemoval;
  const devices = [...space.devices].sort((left, right) => {
    const leftRank = left.isLocal ? 0 : left.online ? 1 : 2;
    const rightRank = right.isLocal ? 0 : right.online ? 1 : 2;
    return leftRank - rightRank;
  });
  const onlineCount = devices.filter((device) => device.isLocal || device.online).length;
  const offlineCount = devices.length - onlineCount;
  const removalDeviceName = (deviceId: string) =>
    devices.find((device) => device.deviceId === deviceId)?.displayName ?? deviceId;
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

      {permanentlyLostDeviceId ? (
        <AlertDialog onDismissRequest={() => setPermanentlyLostDeviceId(null)}>
          <AlertDialog.Title>
            <ComposeText>{t('space.removal.permanentLossTitle')}</ComposeText>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <ComposeText>
              {t('space.removal.permanentLossConfirm', {
                device: removalDeviceName(permanentlyLostDeviceId),
              })}
            </ComposeText>
          </AlertDialog.Text>
          <AlertDialog.ConfirmButton>
            <TextButton onClick={() => void continueMemberRemoval()}>
              <ComposeText>{t('space.removal.permanentLossAction')}</ComposeText>
            </TextButton>
          </AlertDialog.ConfirmButton>
          <AlertDialog.DismissButton>
            <TextButton onClick={() => setPermanentlyLostDeviceId(null)}>
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
        <ListItem>
          <ListItem.LeadingContent>
            <CircularProgressIndicator modifiers={[widthModifier(24), heightModifier(24)]} />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <ComposeText>{t('state.loading', { ns: 'common' })}</ComposeText>
          </ListItem.HeadlineContent>
        </ListItem>
      </SettingsSectionItem>
    );
  }

  if (!spaceId) {
    return (
      <SettingsSectionItem title={t('space.title')} footer={t('space.footer')} dialogs={dialogs}>
        <Column horizontalAlignment="center" modifiers={[fillMaxWidth(), padding(24, 28, 24, 28)]}>
          <Icon source={ICONS.space} size={52} tint={colors.primary} />
          <Spacer modifiers={[heightModifier(16)]} />
          <ComposeText style={EMPTY_TITLE_STYLE}>{t('space.empty.title')}</ComposeText>
          <Spacer modifiers={[heightModifier(8)]} />
          <ComposeText color={colors.onSurfaceVariant} style={EMPTY_BODY_STYLE}>
            {error ?? t('space.empty.body')}
          </ComposeText>
          <Spacer modifiers={[heightModifier(24)]} />
          <Button onClick={() => setSetupMode('create')} modifiers={[fillMaxWidth()]}>
            <Icon source={ICONS.space} size={18} tint={colors.onPrimary} />
            <Spacer modifiers={[widthModifier(8)]} />
            <ComposeText>{t('space.create.title')}</ComposeText>
          </Button>
          <Spacer modifiers={[heightModifier(10)]} />
          <OutlinedButton onClick={() => setSetupMode('join')} modifiers={[fillMaxWidth()]}>
            <Icon source={ICONS.device} size={18} tint={colors.primary} />
            <Spacer modifiers={[widthModifier(8)]} />
            <ComposeText>{t('space.join.title')}</ComposeText>
          </OutlinedButton>
        </Column>
      </SettingsSectionItem>
    );
  }

  return (
    <Column modifiers={[fillMaxWidth()]}>
      {dialogs}

      {error ? (
        <SettingsSectionItem title={t('space.error.title')}>
          <ListItem>
            <ListItem.LeadingContent>
              <Icon source={ICONS.space} size={24} tint={colors.error} />
            </ListItem.LeadingContent>
            <ListItem.HeadlineContent>
              <ComposeText color={colors.error}>{error}</ComposeText>
            </ListItem.HeadlineContent>
          </ListItem>
        </SettingsSectionItem>
      ) : null}

      {error ? <Spacer modifiers={[heightModifier(16)]} /> : null}
      <SettingsSectionItem
        title={t('space.overview.title')}
        footer={t('connection.p2pDescription')}
      >
        <ListItem>
          <ListItem.LeadingContent>
            <Icon source={ICONS.ready} size={30} tint={colors.primary} />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <ComposeText>{t('space.overview.syncHealthy')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText color={colors.onSurfaceVariant}>
              {t('space.overview.deviceSummary', { online: onlineCount, offline: offlineCount })}
            </ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <IconButton onClick={() => setShowInvitation(true)}>
              <Icon
                source={ICONS.add}
                size={24}
                tint={colors.primary}
                contentDescription={t('space.invitation.addA11y')}
              />
            </IconButton>
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>

      {memberRemoval ? (
        <>
          <Spacer modifiers={[heightModifier(16)]} />
          <SettingsSectionItem
            title={t('space.removal.title')}
            footer={
              memberRemoval.outcome === 'complete' || memberRemoval.outcome === 'localOnly'
                ? t('space.removal.complete')
                : memberRemoval.outcome === 'recoveryRequired'
                ? t('space.removal.recoveryRequired')
                : t('space.removal.waiting')
            }
          >
            {memberRemoval.pendingRecipientDeviceIds.map((deviceId, index) => (
              <Column key={deviceId} modifiers={[fillMaxWidth()]}>
                {index > 0 ? <HorizontalDivider /> : null}
                <ListItem>
                  <ListItem.LeadingContent>
                    <Icon source={ICONS.device} size={24} tint={colors.primary} />
                  </ListItem.LeadingContent>
                  <ListItem.HeadlineContent>
                    <ComposeText>{removalDeviceName(deviceId)}</ComposeText>
                  </ListItem.HeadlineContent>
                  <ListItem.SupportingContent>
                    <ComposeText color={colors.onSurfaceVariant}>
                      {t('space.removal.pendingDevice')}
                    </ComposeText>
                  </ListItem.SupportingContent>
                  {memberRemoval.outcome === 'recoveryRequired' ? (
                    <ListItem.TrailingContent>
                      {pending === `recover:${deviceId}` ? (
                        <CircularProgressIndicator
                          modifiers={[widthModifier(24), heightModifier(24)]}
                        />
                      ) : (
                        <TextButton onClick={() => setPermanentlyLostDeviceId(deviceId)}>
                          <ComposeText color={colors.error}>
                            {t('space.removal.permanentLossAction')}
                          </ComposeText>
                        </TextButton>
                      )}
                    </ListItem.TrailingContent>
                  ) : null}
                </ListItem>
              </Column>
            ))}
          </SettingsSectionItem>
        </>
      ) : null}

      <Spacer modifiers={[heightModifier(16)]} />
      <SettingsSectionItem title={`${t('space.devices.title')} (${devices.length})`}>
        {devices.length ? (
          devices.map((device, index) => (
            <Column key={device.deviceId} modifiers={[fillMaxWidth()]}>
              {index > 0 ? <HorizontalDivider /> : null}
              <SpaceDeviceRow
                device={device}
                removing={pending === `remove:${device.deviceId}`}
                onManage={() => setRemoveDeviceId(device.deviceId)}
              />
            </Column>
          ))
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
      <SettingsSectionItem title={t('space.switch.title')} footer={t('space.switch.description')}>
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
      <SettingsSectionItem title={t('space.leave.action')} footer={t('space.leave.confirm')}>
        <ListItem modifiers={[clickable(() => setConfirmLeave(true))]}>
          <ListItem.HeadlineContent>
            <ComposeText color={colors.error}>{t('space.leave.action')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.TrailingContent>
            {pending === 'leave' ? (
              <CircularProgressIndicator modifiers={[widthModifier(24), heightModifier(24)]} />
            ) : (
              <Icon source={ICONS.chevron} size={20} tint={colors.error} />
            )}
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>
    </Column>
  );
});
