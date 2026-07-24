import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Column,
  Host,
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

import { getUnifiedSpaceService } from '@/services/UnifiedSpaceService';
import type { InvitationIssued } from 'uc-engine';
import type { AddSyncConnectionSheetProps } from './AddSyncConnectionSheet.types';

type Mode = 'choose' | 'create' | 'join' | 'invitation';

export function AddSyncConnectionSheet({
  visible,
  legacyLanEligible,
  initialMode = 'choose',
  onClose,
  onOpenLegacyLan,
  onConnected,
}: AddSyncConnectionSheetProps) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [deviceName, setDeviceName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const deviceNameState = useNativeState(deviceName);
  const passphraseState = useNativeState(passphrase);
  const invitationCodeState = useNativeState(invitationCode);

  const reset = () => {
    setMode(initialMode);
    setDeviceName('');
    setPassphrase('');
    setInvitationCode('');
    setInvitation(null);
    setError(null);
    deviceNameState.value = '';
    passphraseState.value = '';
    invitationCodeState.value = '';
  };

  useEffect(() => {
    if (visible) setMode(initialMode);
  }, [initialMode, visible]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const close = () => {
    if (pending) return;
    reset();
    onClose();
  };

  const completeConnection = async () => {
    if ((await onConnected?.()) === false) return;
    if (!mountedRef.current) return;
    reset();
    onClose();
  };

  const openLegacyLan = () => {
    reset();
    onClose();
    onOpenLegacyLan();
  };

  const submit = async () => {
    if (pending || (mode !== 'create' && mode !== 'join')) return;
    setPending(true);
    setError(null);
    try {
      if (mode === 'create') {
        const created = await getUnifiedSpaceService().createSpace(deviceName, passphrase);
        setInvitation(created.invitation);
        setMode('invitation');
      } else {
        await getUnifiedSpaceService().joinSpace(invitationCode, deviceName, passphrase);
        await completeConnection();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('space.error.operationFailed'));
    } finally {
      setPending(false);
    }
  };

  if (!visible) return null;

  return (
    <Host>
      <ModalBottomSheet onDismissRequest={close} initialFullyExpanded>
        <Column modifiers={[paddingAll(24), fillMaxWidth(), verticalScroll()]}>
          <ComposeText style={{ typography: 'titleLarge' }}>{t('connection.addTitle')}</ComposeText>
          <Spacer modifiers={[heightModifier(16)]} />

          {mode === 'choose' ? (
            <Column modifiers={[fillMaxWidth()]}>
              <Button onClick={() => setMode('create')} modifiers={[fillMaxWidth()]}>
                <ComposeText>{t('space.create.title')}</ComposeText>
              </Button>
              <Spacer modifiers={[heightModifier(12)]} />
              <OutlinedButton onClick={() => setMode('join')} modifiers={[fillMaxWidth()]}>
                <ComposeText>{t('space.join.title')}</ComposeText>
              </OutlinedButton>
              {legacyLanEligible ? (
                <>
                  <Spacer modifiers={[heightModifier(20)]} />
                  <TextButton onClick={openLegacyLan} modifiers={[fillMaxWidth()]}>
                    <ComposeText>{t('connection.legacyLanAction')}</ComposeText>
                  </TextButton>
                  <ComposeText color={colors.onSurfaceVariant}>
                    {t('connection.lanDeprecated')}
                  </ComposeText>
                </>
              ) : null}
            </Column>
          ) : null}

          {mode === 'create' || mode === 'join' ? (
            <Column modifiers={[fillMaxWidth()]}>
              {mode === 'join' ? (
                <>
                  <OutlinedTextField
                    value={invitationCodeState}
                    onValueChange={setInvitationCode}
                    modifiers={[fillMaxWidth()]}
                    singleLine
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
                modifiers={[fillMaxWidth()]}
                singleLine
              >
                <OutlinedTextField.Label>
                  <ComposeText>{t('space.field.deviceName')}</ComposeText>
                </OutlinedTextField.Label>
              </OutlinedTextField>
              <Spacer modifiers={[heightModifier(12)]} />
              <OutlinedTextField
                value={passphraseState}
                onValueChange={setPassphrase}
                modifiers={[fillMaxWidth()]}
                visualTransformation="password"
                singleLine
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
              <Row horizontalArrangement="end" modifiers={[fillMaxWidth()]}>
                <TextButton onClick={() => setMode('choose')} enabled={!pending}>
                  <ComposeText>{t('action.back', { ns: 'common' })}</ComposeText>
                </TextButton>
                <Spacer modifiers={[widthModifier(8)]} />
                <Button onClick={submit} enabled={!pending}>
                  <ComposeText>
                    {pending ? t('space.working') : t(`space.${mode}.action`)}
                  </ComposeText>
                </Button>
              </Row>
            </Column>
          ) : null}

          {mode === 'invitation' && invitation ? (
            <Column modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('space.invitation.code')}</ComposeText>
              <ComposeText style={{ typography: 'headlineMedium' }}>
                {invitation.invitationCode}
              </ComposeText>
              <ComposeText color={colors.onSurfaceVariant}>
                {t('connection.invitationExpires', {
                  time: new Date(invitation.expiresAtMs).toLocaleTimeString(),
                })}
              </ComposeText>
              <Spacer modifiers={[heightModifier(20)]} />
              <Button onClick={() => void completeConnection()} modifiers={[fillMaxWidth()]}>
                <ComposeText>{t('action.done', { ns: 'common' })}</ComposeText>
              </Button>
            </Column>
          ) : null}
        </Column>
      </ModalBottomSheet>
    </Host>
  );
}
