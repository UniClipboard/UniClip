import { useEffect, useRef, useState } from 'react';
import {
  BottomSheet,
  Button as SwiftUIButton,
  Host,
  LabeledContent,
  List,
  SecureField,
  type SecureFieldRef,
  Section,
  Text as SwiftUIText,
  TextField,
  type TextFieldRef,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  foregroundStyle,
  frame,
  opacity,
  presentationDetents,
  presentationDragIndicator,
  textFieldStyle,
} from '@expo/ui/swift-ui/modifiers';
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
  const [mode, setMode] = useState<Mode>(initialMode);
  const [deviceName, setDeviceName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const deviceNameRef = useRef<TextFieldRef>(null);
  const passphraseRef = useRef<SecureFieldRef>(null);
  const invitationCodeRef = useRef<TextFieldRef>(null);

  const reset = () => {
    setMode(initialMode);
    setDeviceName('');
    setPassphrase('');
    setInvitationCode('');
    setInvitation(null);
    setError(null);
    void deviceNameRef.current?.clear();
    void passphraseRef.current?.clear();
    void invitationCodeRef.current?.clear();
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

  return (
    <Host style={{ position: 'absolute', width: 0, height: 0 }}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => {
          if (!presented) close();
        }}
      >
        <List modifiers={[presentationDetents(['large']), presentationDragIndicator('visible')]}>
          <Section
            header={<SwiftUIText>{t('connection.addTitle')}</SwiftUIText>}
            footer={
              legacyLanEligible && mode === 'choose' ? (
                <SwiftUIText>{t('connection.lanDeprecated')}</SwiftUIText>
              ) : undefined
            }
          >
            {mode === 'choose' ? (
              <>
                <SwiftUIButton
                  systemImage="plus.circle.fill"
                  label={t('space.create.title')}
                  onPress={() => setMode('create')}
                  modifiers={[buttonStyle('borderedProminent')]}
                />
                <SwiftUIButton
                  systemImage="link.circle.fill"
                  label={t('space.join.title')}
                  onPress={() => setMode('join')}
                />
                {legacyLanEligible ? (
                  <SwiftUIButton
                    systemImage="server.rack"
                    label={t('connection.legacyLanAction')}
                    onPress={openLegacyLan}
                  />
                ) : null}
              </>
            ) : null}

            {mode === 'create' || mode === 'join' ? (
              <>
                {mode === 'join' ? (
                  <TextField
                    ref={invitationCodeRef}
                    placeholder={t('space.field.invitationCode')}
                    onTextChange={setInvitationCode}
                    modifiers={[textFieldStyle('plain'), frame({ minHeight: 24 })]}
                  />
                ) : null}
                <TextField
                  ref={deviceNameRef}
                  placeholder={t('space.field.deviceName')}
                  onTextChange={setDeviceName}
                  modifiers={[textFieldStyle('plain'), frame({ minHeight: 24 })]}
                />
                <SecureField
                  ref={passphraseRef}
                  placeholder={t('space.field.passphrase')}
                  onTextChange={setPassphrase}
                  modifiers={[frame({ minHeight: 24 })]}
                />
                <SwiftUIButton
                  systemImage={mode === 'create' ? 'plus.circle.fill' : 'link.circle.fill'}
                  label={pending ? t('space.working') : t(`space.${mode}.action`)}
                  onPress={submit}
                  modifiers={[buttonStyle('borderedProminent'), opacity(pending ? 0.45 : 1)]}
                />
                <SwiftUIButton
                  systemImage="chevron.backward"
                  label={t('action.back', { ns: 'common' })}
                  onPress={() => setMode('choose')}
                />
              </>
            ) : null}

            {mode === 'invitation' && invitation ? (
              <>
                <LabeledContent label={t('space.invitation.code')}>
                  <SwiftUIText>{invitation.invitationCode}</SwiftUIText>
                </LabeledContent>
                <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                  {t('connection.invitationExpires', {
                    time: new Date(invitation.expiresAtMs).toLocaleTimeString(),
                  })}
                </SwiftUIText>
                <SwiftUIButton
                  systemImage="checkmark.circle.fill"
                  label={t('action.done', { ns: 'common' })}
                  onPress={() => void completeConnection()}
                  modifiers={[buttonStyle('borderedProminent')]}
                />
              </>
            ) : null}
          </Section>

          {error ? (
            <Section>
              <SwiftUIText modifiers={[foregroundStyle('red')]}>{error}</SwiftUIText>
            </Section>
          ) : null}
        </List>
      </BottomSheet>
    </Host>
  );
}
