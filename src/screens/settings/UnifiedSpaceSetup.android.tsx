import { memo, useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import type { InvitationIssued } from 'uc-engine';
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
  fillMaxWidth,
  height as heightModifier,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { getUnifiedSpaceService, UnifiedSpaceInputError } from '@/services/UnifiedSpaceService';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore, type UnifiedSpaceDevice } from '@/stores/unifiedSpaceStore';
import { SettingsSectionItem } from './SettingsSectionItem';

type PendingOperation = 'invite' | 'leave' | `remove:${string}` | null;

const ICONS = {
  space: require('../../assets/icons/groups.xml'),
  device: require('../../assets/icons/account_circle.xml'),
  ready: require('../../assets/icons/check_circle.xml'),
  status: require('../../assets/icons/circle.xml'),
  copy: require('../../assets/icons/content_copy.xml'),
  remove: require('../../assets/icons/delete.xml'),
};

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

function CopyableValue({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();

  return (
    <ListItem>
      <ListItem.HeadlineContent>
        <ComposeText>{label}</ComposeText>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <ComposeText>{value}</ComposeText>
      </ListItem.SupportingContent>
      <ListItem.TrailingContent>
        <IconButton onClick={onCopy}>
          <Icon
            source={copied ? ICONS.ready : ICONS.copy}
            size={20}
            tint={copied ? colors.primary : colors.onSurfaceVariant}
            contentDescription={t('action.copy', { ns: 'common' })}
          />
        </IconButton>
      </ListItem.TrailingContent>
    </ListItem>
  );
}

function SpaceDeviceRow({
  device,
  removing,
  onRemove,
}: {
  device: UnifiedSpaceDevice;
  removing: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const online = device.isLocal || device.online;
  const statusColor = online ? colors.primary : colors.outline;

  return (
    <ListItem>
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
      <ListItem.TrailingContent>
        {device.isLocal ? null : removing ? (
          <CircularProgressIndicator modifiers={[widthModifier(24), heightModifier(24)]} />
        ) : (
          <IconButton onClick={onRemove}>
            <Icon
              source={ICONS.remove}
              size={20}
              tint={colors.error}
              contentDescription={t('space.devices.remove')}
            />
          </IconButton>
        )}
      </ListItem.TrailingContent>
    </ListItem>
  );
}

export const UnifiedSpaceSetup = memo(function UnifiedSpaceSetup() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const [setupMode, setSetupMode] = useState<AddSyncConnectionMode | null>(null);
  const [pending, setPending] = useState<PendingOperation>(null);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [removeDeviceId, setRemoveDeviceId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const space = useUnifiedSpaceStore();
  const refreshRevision = useUnifiedEngineStore((state) => state.refreshRevision);

  useEffect(() => {
    void getUnifiedSpaceService()
      .refresh()
      .catch((cause) => setError(operationError(cause, t)));
  }, [refreshRevision, t]);

  const issueInvitation = async () => {
    if (pending) return;
    setPending('invite');
    setError(null);
    setCopiedValue(null);
    try {
      setInvitation(await getUnifiedSpaceService().issueInvitation());
    } catch (cause) {
      setError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const copyValue = async (value: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedValue(value);
  };

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

  const leaveSpace = async () => {
    if (pending) return;
    setConfirmLeave(false);
    setPending('leave');
    setError(null);
    try {
      await getUnifiedSpaceService().leaveSpace();
      setInvitation(null);
      setCopiedValue(null);
    } catch (cause) {
      setError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const spaceId = space.spaceId;
  const visibleInvitation = invitation ?? space.invitation;
  const invitationDescription = visibleInvitation
    ? 'availability' in visibleInvitation
      ? t(
          visibleInvitation.availability === 'sameLocalNetwork'
            ? 'space.invitation.sameLocalNetwork'
            : 'space.invitation.crossNetwork'
        )
      : t('space.invitation.description')
    : t('space.invitation.description');
  const invitationFooter = visibleInvitation
    ? `${invitationDescription}\n${t('connection.invitationExpires', {
        time: new Date(visibleInvitation.expiresAtMs).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      })}`
    : invitationDescription;
  const isInitialLoading =
    !spaceId && !pending && (space.status === 'idle' || space.status === 'loading');

  const dialogs = (
    <>
      <AddSyncConnectionSheet
        visible={setupMode !== null}
        initialMode={setupMode ?? 'choose'}
        legacyLanEligible={false}
        onClose={() => setSetupMode(null)}
        onOpenLegacyLan={() => {}}
        onConnected={() => {
          setSetupMode(null);
          return true;
        }}
      />

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
      <SettingsSectionItem title={t('space.mode')} footer={t('space.footer')} dialogs={dialogs}>
        <ListItem>
          <ListItem.LeadingContent>
            <Icon source={ICONS.space} size={26} tint={colors.primary} />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <ComposeText>{t('space.create.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{t('space.create.description')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <Button onClick={() => setSetupMode('create')}>
              <ComposeText>{t('space.create.action')}</ComposeText>
            </Button>
          </ListItem.TrailingContent>
        </ListItem>
        <HorizontalDivider />
        <ListItem>
          <ListItem.LeadingContent>
            <Icon source={ICONS.device} size={26} tint={colors.secondary} />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <ComposeText>{t('space.join.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText>{error ?? t('space.join.description')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <OutlinedButton onClick={() => setSetupMode('join')}>
              <ComposeText>{t('space.join.action')}</ComposeText>
            </OutlinedButton>
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>
    );
  }

  return (
    <Column modifiers={[fillMaxWidth()]}>
      {dialogs}
      <SettingsSectionItem title={t('space.status.ready')} footer={t('connection.p2pDescription')}>
        <ListItem>
          <ListItem.LeadingContent>
            <Icon source={ICONS.space} size={28} tint={colors.primary} />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <ComposeText>{t('space.status.ready')}</ComposeText>
          </ListItem.HeadlineContent>
          {space.deviceName ? (
            <ListItem.SupportingContent>
              <ComposeText>
                {t('space.status.currentDevice', { name: space.deviceName })}
              </ComposeText>
            </ListItem.SupportingContent>
          ) : null}
          <ListItem.TrailingContent>
            <Icon source={ICONS.ready} size={24} tint={colors.primary} />
          </ListItem.TrailingContent>
        </ListItem>
        <HorizontalDivider />
        <CopyableValue
          label={t('space.status.spaceId')}
          value={spaceId}
          copied={copiedValue === spaceId}
          onCopy={() => void copyValue(spaceId)}
        />
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(16)]} />
      <SettingsSectionItem title={`${t('space.devices.title')} (${space.devices.length})`}>
        {space.devices.length ? (
          space.devices.map((device, index) => (
            <Column key={device.deviceId} modifiers={[fillMaxWidth()]}>
              {index > 0 ? <HorizontalDivider /> : null}
              <SpaceDeviceRow
                device={device}
                removing={pending === `remove:${device.deviceId}`}
                onRemove={() => setRemoveDeviceId(device.deviceId)}
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
      <SettingsSectionItem title={t('space.invitation.title')} footer={invitationFooter}>
        {visibleInvitation ? (
          <>
            <CopyableValue
              label={t('space.invitation.code')}
              value={visibleInvitation.invitationCode}
              copied={copiedValue === visibleInvitation.invitationCode}
              onCopy={() => void copyValue(visibleInvitation.invitationCode)}
            />
            <HorizontalDivider />
          </>
        ) : null}
        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText>{t('space.invitation.description')}</ComposeText>
          </ListItem.HeadlineContent>
          {error ? (
            <ListItem.SupportingContent>
              <ComposeText color={colors.error}>{error}</ComposeText>
            </ListItem.SupportingContent>
          ) : null}
          <ListItem.TrailingContent>
            <OutlinedButton onClick={issueInvitation} enabled={!pending}>
              <ComposeText>
                {pending === 'invite' ? t('space.working') : t('space.invitation.action')}
              </ComposeText>
            </OutlinedButton>
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>

      <Spacer modifiers={[heightModifier(16)]} />
      <SettingsSectionItem title={t('space.leave.action')} footer={t('space.leave.confirm')}>
        <ListItem>
          <ListItem.HeadlineContent>
            <ComposeText color={colors.error}>{t('space.leave.action')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.TrailingContent>
            <TextButton onClick={() => setConfirmLeave(true)} enabled={!pending}>
              <ComposeText>{t('space.leave.action')}</ComposeText>
            </TextButton>
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>
    </Column>
  );
});
