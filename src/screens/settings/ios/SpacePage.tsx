import { useRef, useState } from 'react';
import type { InvitationIssued, SpaceCreated, SpaceJoined } from 'uc-engine';
import {
  Button as SwiftUIButton,
  HStack,
  LabeledContent,
  Picker,
  ProgressView,
  Section,
  SecureField,
  type SecureFieldRef,
  Text as SwiftUIText,
  TextField,
  type TextFieldRef,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  foregroundStyle,
  frame,
  opacity,
  pickerStyle,
  tag,
  textFieldStyle,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import {
  getUnifiedSpaceService,
  UnifiedSpaceInputError,
} from '@/services/UnifiedSpaceService';
import { HeaderCircleButton } from './common';

type SetupMode = 'create' | 'join';
type PendingOperation = SetupMode | 'invite' | null;

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

export function SpacePage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('settingsSync');
  const [mode, setMode] = useState<SetupMode>('create');
  const [deviceName, setDeviceName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [pending, setPending] = useState<PendingOperation>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<SpaceCreated | null>(null);
  const [joined, setJoined] = useState<SpaceJoined | null>(null);
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);

  const deviceNameRef = useRef<TextFieldRef>(null);
  const invitationCodeRef = useRef<TextFieldRef>(null);
  const passphraseRef = useRef<SecureFieldRef>(null);

  const clearSensitiveInput = () => {
    setPassphrase('');
    void passphraseRef.current?.clear();
  };

  const handleBack = () => {
    if (pending) return;
    setDeviceName('');
    setInvitationCode('');
    setError(null);
    setCreated(null);
    setJoined(null);
    setInvitation(null);
    clearSensitiveInput();
    void deviceNameRef.current?.clear();
    void invitationCodeRef.current?.clear();
    onBack();
  };

  const submit = async () => {
    if (pending) return;
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
      clearSensitiveInput();
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

  const spaceId = created?.spaceId ?? joined?.spaceId;
  const invitationDescription = invitation
    ? t(
        invitation.availability === 'sameLocalNetwork'
          ? 'space.invitation.sameLocalNetwork'
          : 'space.invitation.crossNetwork'
      )
    : t('space.invitation.description');

  return (
    <IosSheetPage
      title={t('space.title')}
      leftSlots={[
        <HeaderCircleButton key="back" systemName="chevron.left" onPress={handleBack} />,
      ]}
    >
      <IosSheetForm>
        <Section footer={<SwiftUIText>{t('space.footer')}</SwiftUIText>}>
          <Picker
            label={t('space.mode')}
            selection={mode}
            onSelectionChange={(value) => {
              setMode(value as SetupMode);
              setError(null);
              clearSensitiveInput();
            }}
            modifiers={[pickerStyle('segmented')]}
          >
            <SwiftUIText modifiers={[tag('create')]}>{t('space.create.action')}</SwiftUIText>
            <SwiftUIText modifiers={[tag('join')]}>{t('space.join.action')}</SwiftUIText>
          </Picker>
        </Section>

        <Section title={t(`space.${mode}.title`)}>
          {mode === 'join' ? (
            <TextField
              ref={invitationCodeRef}
              placeholder={t('space.field.invitationCode')}
              onTextChange={setInvitationCode}
              modifiers={[textFieldStyle('plain'), frame({ minHeight: 22 })]}
            />
          ) : null}
          <TextField
            ref={deviceNameRef}
            placeholder={t('space.field.deviceName')}
            onTextChange={setDeviceName}
            modifiers={[textFieldStyle('plain'), frame({ minHeight: 22 })]}
          />
          <SecureField
            ref={passphraseRef}
            placeholder={t('space.field.passphrase')}
            onTextChange={setPassphrase}
            modifiers={[frame({ minHeight: 22 })]}
          />
          <SwiftUIButton
            systemImage={mode === 'create' ? 'plus.circle.fill' : 'link.circle.fill'}
            label={pending === mode ? t('space.working') : t(`space.${mode}.action`)}
            onPress={submit}
            modifiers={[buttonStyle('borderedProminent'), opacity(pending ? 0.45 : 1)]}
          />
        </Section>

        {error ? (
          <Section>
            <SwiftUIText modifiers={[foregroundStyle('red')]}>{error}</SwiftUIText>
          </Section>
        ) : null}

        {spaceId ? (
          <Section header={<SwiftUIText>{t('space.status.ready')}</SwiftUIText>}>
            <LabeledContent label={t('space.status.spaceId')}>
              <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{spaceId}</SwiftUIText>
            </LabeledContent>
          </Section>
        ) : null}

        <Section
          header={<SwiftUIText>{t('space.invitation.title')}</SwiftUIText>}
          footer={<SwiftUIText>{invitationDescription}</SwiftUIText>}
        >
          {invitation ? (
            <LabeledContent label={t('space.invitation.code')}>
              <SwiftUIText>{invitation.invitationCode}</SwiftUIText>
            </LabeledContent>
          ) : null}
          {pending === 'invite' ? (
            <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
              <ProgressView />
              <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                {t('space.working')}
              </SwiftUIText>
            </HStack>
          ) : (
            <SwiftUIButton
              systemImage="person.badge.plus"
              label={t('space.invitation.action')}
              onPress={issueInvitation}
            />
          )}
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
