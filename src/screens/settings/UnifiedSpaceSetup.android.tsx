import { memo, useEffect, useState } from 'react';
import type { InvitationIssued, SpaceCreated, SpaceJoined } from 'uc-engine';
import {
  Button,
  AlertDialog,
  Column,
  HorizontalDivider,
  ListItem,
  ModalBottomSheet,
  OutlinedButton,
  OutlinedTextField,
  Row,
  Spacer,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height as heightModifier,
  paddingAll,
  verticalScroll,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { getUnifiedSpaceService, UnifiedSpaceInputError } from '@/services/UnifiedSpaceService';
import { useUnifiedSpaceStore } from '@/stores/unifiedSpaceStore';
import { SettingsSectionItem } from './SettingsSectionItem';

type SetupMode = 'create' | 'join';
type PendingOperation = SetupMode | 'invite' | 'leave' | `remove:${string}` | null;
const sheetTitleStyle = { typography: 'titleLarge' } as const;

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

export const UnifiedSpaceSetup = memo(function UnifiedSpaceSetup() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const [mode, setMode] = useState<SetupMode | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [pending, setPending] = useState<PendingOperation>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<SpaceCreated | null>(null);
  const [joined, setJoined] = useState<SpaceJoined | null>(null);
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);
  const [removeDeviceId, setRemoveDeviceId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const space = useUnifiedSpaceStore();

  const deviceNameState = useNativeState(deviceName);
  const passphraseState = useNativeState(passphrase);
  const invitationCodeState = useNativeState(invitationCode);

  useEffect(() => {
    void getUnifiedSpaceService().refresh();
  }, []);

  const resetInputs = () => {
    setDeviceName('');
    setPassphrase('');
    setInvitationCode('');
    deviceNameState.value = '';
    passphraseState.value = '';
    invitationCodeState.value = '';
  };

  const closeForm = () => {
    if (pending) return;
    resetInputs();
    setError(null);
    setMode(null);
  };

  const openForm = (nextMode: SetupMode) => {
    resetInputs();
    setError(null);
    setMode(nextMode);
  };

  const submit = async () => {
    if (!mode || pending) return;
    setPending(mode);
    setError(null);
    try {
      const service = getUnifiedSpaceService();
      if (mode === 'create') {
        setCreated(await service.createSpace(deviceName, passphrase));
        setJoined(null);
      } else {
        setJoined(await service.joinSpace(invitationCode, deviceName, passphrase));
        setCreated(null);
      }
      resetInputs();
      setMode(null);
    } catch (cause) {
      setError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const issueInvitation = async () => {
    if (pending) return;
    setPending('invite');
    setError(null);
    try {
      setInvitation(await getUnifiedSpaceService().issueInvitation());
    } catch (cause) {
      setError(operationError(cause, t));
    } finally {
      setPending(null);
    }
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
      setCreated(null);
      setJoined(null);
      setInvitation(null);
    } catch (cause) {
      setError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const spaceId = space.spaceId ?? created?.spaceId ?? joined?.spaceId;

  return (
    <SettingsSectionItem
      title={t('space.title')}
      footer={t('space.footer')}
      dialogs={
        <>
          {mode ? (
            <ModalBottomSheet
              onDismissRequest={closeForm}
              skipPartiallyExpanded
              initialFullyExpanded
            >
              <Column modifiers={[paddingAll(24), fillMaxWidth(), verticalScroll()]}>
                <ComposeText style={sheetTitleStyle}>{t(`space.${mode}.title`)}</ComposeText>
                <Spacer modifiers={[heightModifier(16)]} />

                {mode === 'join' ? (
                  <>
                    <OutlinedTextField
                      value={invitationCodeState}
                      onValueChange={setInvitationCode}
                      singleLine
                      keyboardOptions={{ capitalization: 'none', autoCorrectEnabled: false }}
                      modifiers={[fillMaxWidth()]}
                    >
                      <OutlinedTextField.Label>
                        <ComposeText>{t('space.field.invitationCode')}</ComposeText>
                      </OutlinedTextField.Label>
                    </OutlinedTextField>
                    <Spacer modifiers={[heightModifier(12)]} />
                  </>
                ) : null}

                <OutlinedTextField
                  value={deviceNameState}
                  onValueChange={setDeviceName}
                  singleLine
                  keyboardOptions={{ capitalization: 'words' }}
                  modifiers={[fillMaxWidth()]}
                >
                  <OutlinedTextField.Label>
                    <ComposeText>{t('space.field.deviceName')}</ComposeText>
                  </OutlinedTextField.Label>
                </OutlinedTextField>
                <Spacer modifiers={[heightModifier(12)]} />

                <OutlinedTextField
                  value={passphraseState}
                  onValueChange={setPassphrase}
                  singleLine
                  visualTransformation="password"
                  keyboardOptions={{ keyboardType: 'password', autoCorrectEnabled: false }}
                  modifiers={[fillMaxWidth()]}
                >
                  <OutlinedTextField.Label>
                    <ComposeText>{t('space.field.passphrase')}</ComposeText>
                  </OutlinedTextField.Label>
                </OutlinedTextField>

                {error ? (
                  <>
                    <Spacer modifiers={[heightModifier(12)]} />
                    <ComposeText color={colors.error}>{error}</ComposeText>
                  </>
                ) : null}

                <Spacer modifiers={[heightModifier(20)]} />
                <Row modifiers={[fillMaxWidth()]} horizontalArrangement="end">
                  <TextButton onClick={closeForm} enabled={!pending}>
                    <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
                  </TextButton>
                  <Spacer modifiers={[widthModifier(8)]} />
                  <Button onClick={submit} enabled={!pending}>
                    <ComposeText>
                      {pending ? t('space.working') : t(`space.${mode}.action`)}
                    </ComposeText>
                  </Button>
                </Row>
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
      }
    >
      {spaceId ? (
        <>
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('space.status.ready')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>{spaceId}</ComposeText>
            </ListItem.SupportingContent>
          </ListItem>
          <HorizontalDivider />
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('space.devices.title')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>
                {space.devices.length ? `${space.devices.length}` : t('space.devices.empty')}
              </ComposeText>
            </ListItem.SupportingContent>
          </ListItem>
          {space.devices.map((device) => (
            <ListItem key={device.deviceId}>
              <ListItem.HeadlineContent>
                <ComposeText>{device.displayName}</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.SupportingContent>
                <ComposeText>
                  {t(device.online ? 'space.devices.online' : 'space.devices.offline')}
                </ComposeText>
              </ListItem.SupportingContent>
              <ListItem.TrailingContent>
                <TextButton onClick={() => setRemoveDeviceId(device.deviceId)} enabled={!pending}>
                  <ComposeText>{t('space.devices.remove')}</ComposeText>
                </TextButton>
              </ListItem.TrailingContent>
            </ListItem>
          ))}
          <HorizontalDivider />
          {invitation ? (
            <ListItem>
              <ListItem.HeadlineContent>
                <ComposeText>{t('space.invitation.code')}</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.SupportingContent>
                <Column>
                  <ComposeText>{invitation.invitationCode}</ComposeText>
                  <ComposeText color={colors.onSurfaceVariant}>
                    {t(
                      invitation.availability === 'sameLocalNetwork'
                        ? 'space.invitation.sameLocalNetwork'
                        : 'space.invitation.crossNetwork'
                    )}
                  </ComposeText>
                </Column>
              </ListItem.SupportingContent>
            </ListItem>
          ) : null}
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('space.invitation.title')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>
                {error && !mode ? error : t('space.invitation.description')}
              </ComposeText>
            </ListItem.SupportingContent>
            <ListItem.TrailingContent>
              <OutlinedButton onClick={issueInvitation} enabled={!pending}>
                <ComposeText>
                  {pending === 'invite' ? t('space.working') : t('space.invitation.action')}
                </ComposeText>
              </OutlinedButton>
            </ListItem.TrailingContent>
          </ListItem>
          <HorizontalDivider />
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
        </>
      ) : (
        <>
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('space.create.title')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>{t('space.create.description')}</ComposeText>
            </ListItem.SupportingContent>
            <ListItem.TrailingContent>
              <Button onClick={() => openForm('create')} enabled={!pending}>
                <ComposeText>{t('space.create.action')}</ComposeText>
              </Button>
            </ListItem.TrailingContent>
          </ListItem>
          <HorizontalDivider />
          <ListItem>
            <ListItem.HeadlineContent>
              <ComposeText>{t('space.join.title')}</ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <ComposeText>{t('space.join.description')}</ComposeText>
            </ListItem.SupportingContent>
            <ListItem.TrailingContent>
              <OutlinedButton onClick={() => openForm('join')} enabled={!pending}>
                <ComposeText>{t('space.join.action')}</ComposeText>
              </OutlinedButton>
            </ListItem.TrailingContent>
          </ListItem>
        </>
      )}
    </SettingsSectionItem>
  );
});
