import { useRef } from 'react';
import * as Device from 'expo-device';
import {
  Button,
  CircularProgressIndicator,
  Column,
  Host,
  Icon,
  ModalBottomSheet,
  OutlinedButton,
  OutlinedTextField,
  Row,
  Spacer,
  Text as ComposeText,
  TextButton,
  type TextFieldRef,
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

import { useTheme } from '@/hooks/useTheme';
import { resolveDefaultDeviceName } from '@/utils/deviceName';
import { formatInvitationCode, normalizeInvitationCodeInput } from '@/utils/invitationCode';
import type { AddSyncConnectionSheetProps } from './AddSyncConnectionSheet.types';
import { useAddSyncConnectionFlow } from './useAddSyncConnectionFlow';

const ICONS = {
  space: require('../assets/icons/groups.xml'),
  device: require('../assets/icons/account_circle.xml'),
  ready: require('../assets/icons/check_circle.xml'),
  copy: require('../assets/icons/content_copy.xml'),
};

const TITLE_STYLE = { typography: 'titleLarge' } as const;
const CODE_REVIEW_STYLE = { typography: 'headlineMedium' } as const;
const INVITATION_STYLE = { typography: 'headlineLarge' } as const;
const CODE_INPUT_STYLE = {
  textAlign: 'center',
  fontFamily: 'monospace',
  fontSize: 28,
  fontWeight: '600',
  letterSpacing: 0,
} as const;

function AddSyncConnectionSheetContent({
  visible,
  initialMode = 'choose',
  onClose,
  onConnected,
}: AddSyncConnectionSheetProps) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const defaultDeviceName = resolveDefaultDeviceName(
    Device.deviceName,
    Device.modelName,
    t('space.flow.thisDevice')
  );
  const invitationCodeRef = useRef<TextFieldRef>(null);
  const deviceNameState = useNativeState(defaultDeviceName);
  const passphraseState = useNativeState('');
  const invitationCodeState = useNativeState('');
  const { state, actions } = useAddSyncConnectionFlow({
    visible,
    initialMode,
    defaultDeviceName,
    onClose,
    onConnected,
    resetNativeFields: (nextDeviceName) => {
      deviceNameState.value = nextDeviceName;
      passphraseState.value = '';
      invitationCodeState.value = '';
    },
    clearNativePassphrase: () => {
      passphraseState.value = '';
    },
  });
  const {
    mode,
    deviceName,
    invitationCode,
    invitation,
    pending,
    error,
    copied,
    canSubmitDetails,
    codeComplete,
    invitationExpired,
    invitationTimeRemaining,
    remoteDeviceName,
  } = state;
  const {
    setDeviceName,
    setPassphrase,
    updateInvitationCode,
    continueFromCode,
    selectMode,
    back,
    close,
    submitCreate,
    submitJoin,
    renewInvitation,
    copyInvitation,
    shareInvitation,
    completeConnection,
  } = actions;
  const title =
    mode === 'create'
      ? t('space.create.title')
      : mode === 'joinCode'
      ? t('space.flow.joinCodeTitle')
      : mode === 'joinDetails'
      ? t('space.flow.joinDetailsTitle')
      : mode === 'invitation'
      ? t('space.flow.waitingTitle')
      : mode === 'success'
      ? t('space.flow.successTitle')
      : t('connection.addSheetTitle');

  if (!visible) return null;

  return (
    <ModalBottomSheet onDismissRequest={close}>
      <Column modifiers={[paddingAll(24), fillMaxWidth(), verticalScroll()]}>
        <ComposeText style={TITLE_STYLE}>{title}</ComposeText>
        <Spacer modifiers={[heightModifier(8)]} />

        {mode === 'choose' ? (
          <Column modifiers={[fillMaxWidth()]}>
            <ComposeText color={colors.onSurfaceVariant}>
              {t('connection.p2pDescription')}
            </ComposeText>
            <Spacer modifiers={[heightModifier(20)]} />
            <Button onClick={() => selectMode('create')} modifiers={[fillMaxWidth()]}>
              <Icon source={ICONS.space} size={20} tint={colors.onPrimary} />
              <Spacer modifiers={[widthModifier(8)]} />
              <ComposeText>{t('space.create.title')}</ComposeText>
            </Button>
            <Spacer modifiers={[heightModifier(12)]} />
            <OutlinedButton onClick={() => selectMode('joinCode')} modifiers={[fillMaxWidth()]}>
              <Icon source={ICONS.device} size={20} tint={colors.primary} />
              <Spacer modifiers={[widthModifier(8)]} />
              <ComposeText>{t('space.join.title')}</ComposeText>
            </OutlinedButton>
          </Column>
        ) : null}

        {mode === 'create' ? (
          <Column modifiers={[fillMaxWidth()]}>
            <ComposeText color={colors.onSurfaceVariant}>{t('space.flow.createBody')}</ComposeText>
            <Spacer modifiers={[heightModifier(20)]} />
            <OutlinedTextField
              value={deviceNameState}
              onValueChange={setDeviceName}
              singleLine
              keyboardOptions={{ capitalization: 'words', imeAction: 'next' }}
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
              keyboardOptions={{
                keyboardType: 'password',
                autoCorrectEnabled: false,
                imeAction: 'done',
              }}
              modifiers={[fillMaxWidth()]}
            >
              <OutlinedTextField.Label>
                <ComposeText>{t('space.field.passphrase')}</ComposeText>
              </OutlinedTextField.Label>
            </OutlinedTextField>
            <Spacer modifiers={[heightModifier(20)]} />
            <Button
              onClick={submitCreate}
              enabled={canSubmitDetails && !pending}
              modifiers={[fillMaxWidth()]}
            >
              {pending ? (
                <CircularProgressIndicator modifiers={[widthModifier(20), heightModifier(20)]} />
              ) : (
                <ComposeText>{t('space.create.action')}</ComposeText>
              )}
            </Button>
            <TextButton onClick={back} enabled={!pending} modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('action.back', { ns: 'common' })}</ComposeText>
            </TextButton>
          </Column>
        ) : null}

        {mode === 'joinCode' ? (
          <Column modifiers={[fillMaxWidth()]}>
            <ComposeText color={colors.onSurfaceVariant}>
              {t('space.flow.joinCodeBody')}
            </ComposeText>
            <Spacer modifiers={[heightModifier(24)]} />
            <OutlinedTextField
              ref={invitationCodeRef}
              value={invitationCodeState}
              onValueChange={updateInvitationCode}
              autoFocus
              singleLine
              maxLength={8}
              keyboardOptions={{
                capitalization: 'characters',
                autoCorrectEnabled: false,
                keyboardType: 'ascii',
                imeAction: 'next',
              }}
              textStyle={CODE_INPUT_STYLE}
              keyboardActions={{ onNext: continueFromCode }}
              modifiers={[fillMaxWidth()]}
            >
              <OutlinedTextField.Label>
                <ComposeText>{t('space.field.invitationCode')}</ComposeText>
              </OutlinedTextField.Label>
              <OutlinedTextField.Placeholder>
                <ComposeText>XXXXXXXX</ComposeText>
              </OutlinedTextField.Placeholder>
            </OutlinedTextField>
            <Spacer modifiers={[heightModifier(20)]} />
            <Button onClick={continueFromCode} enabled={codeComplete} modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('space.flow.continue')}</ComposeText>
            </Button>
            <TextButton onClick={back} modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('action.back', { ns: 'common' })}</ComposeText>
            </TextButton>
          </Column>
        ) : null}

        {mode === 'joinDetails' ? (
          <Column modifiers={[fillMaxWidth()]}>
            <ComposeText color={colors.onSurfaceVariant}>
              {t('space.flow.joinDetailsBody')}
            </ComposeText>
            <Spacer modifiers={[heightModifier(12)]} />
            <ComposeText style={CODE_REVIEW_STYLE}>
              {formatInvitationCode(normalizeInvitationCodeInput(invitationCode))}
            </ComposeText>
            <Spacer modifiers={[heightModifier(20)]} />
            <OutlinedTextField
              value={passphraseState}
              onValueChange={setPassphrase}
              autoFocus
              singleLine
              visualTransformation="password"
              keyboardOptions={{
                keyboardType: 'password',
                autoCorrectEnabled: false,
                imeAction: 'next',
              }}
              modifiers={[fillMaxWidth()]}
            >
              <OutlinedTextField.Label>
                <ComposeText>{t('space.field.passphrase')}</ComposeText>
              </OutlinedTextField.Label>
            </OutlinedTextField>
            <Spacer modifiers={[heightModifier(12)]} />
            <OutlinedTextField
              value={deviceNameState}
              onValueChange={setDeviceName}
              singleLine
              keyboardOptions={{ capitalization: 'words', imeAction: 'done' }}
              keyboardActions={{ onDone: () => void submitJoin() }}
              modifiers={[fillMaxWidth()]}
            >
              <OutlinedTextField.Label>
                <ComposeText>{t('space.field.deviceName')}</ComposeText>
              </OutlinedTextField.Label>
            </OutlinedTextField>
            <Spacer modifiers={[heightModifier(20)]} />
            <Button
              onClick={submitJoin}
              enabled={canSubmitDetails && !pending}
              modifiers={[fillMaxWidth()]}
            >
              {pending ? (
                <CircularProgressIndicator modifiers={[widthModifier(20), heightModifier(20)]} />
              ) : (
                <ComposeText>{t('space.join.action')}</ComposeText>
              )}
            </Button>
            <TextButton onClick={back} enabled={!pending} modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('action.back', { ns: 'common' })}</ComposeText>
            </TextButton>
          </Column>
        ) : null}

        {mode === 'invitation' && invitation ? (
          <Column modifiers={[fillMaxWidth()]}>
            <ComposeText color={colors.onSurfaceVariant}>{t('space.flow.waitingBody')}</ComposeText>
            <Spacer modifiers={[heightModifier(24)]} />
            <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
              <Column horizontalAlignment="center">
                <Icon source={ICONS.device} size={36} tint={colors.primary} />
                <ComposeText>{deviceName}</ComposeText>
              </Column>
              <Spacer modifiers={[widthModifier(24)]} />
              <CircularProgressIndicator modifiers={[widthModifier(30), heightModifier(30)]} />
              <Spacer modifiers={[widthModifier(24)]} />
              <Column horizontalAlignment="center">
                <Icon source={ICONS.device} size={36} tint={colors.outline} />
                <ComposeText color={colors.onSurfaceVariant}>
                  {t('space.flow.otherDevice')}
                </ComposeText>
              </Column>
            </Row>
            <ComposeText color={colors.primary}>{t('space.flow.waitingForDevice')}</ComposeText>
            <Spacer modifiers={[heightModifier(24)]} />
            <ComposeText style={INVITATION_STYLE}>{invitation.invitationCode}</ComposeText>
            <Spacer modifiers={[heightModifier(8)]} />
            <ComposeText color={invitationExpired ? colors.error : colors.onSurfaceVariant}>
              {invitationExpired
                ? t('space.flow.expired')
                : t('space.flow.expiresIn', {
                    time: invitationTimeRemaining,
                  })}
            </ComposeText>
            <ComposeText color={colors.onSurfaceVariant}>
              {t(
                invitation.availability === 'sameLocalNetwork'
                  ? 'space.invitation.sameLocalNetwork'
                  : 'space.invitation.crossNetwork'
              )}
            </ComposeText>
            <Spacer modifiers={[heightModifier(20)]} />
            {invitationExpired ? (
              <Button onClick={renewInvitation} enabled={!pending} modifiers={[fillMaxWidth()]}>
                <ComposeText>{t('space.invitation.action')}</ComposeText>
              </Button>
            ) : (
              <Row modifiers={[fillMaxWidth()]}>
                <OutlinedButton onClick={copyInvitation} modifiers={[fillMaxWidth(0.5)]}>
                  <Icon
                    source={copied ? ICONS.ready : ICONS.copy}
                    size={18}
                    tint={colors.primary}
                  />
                  <Spacer modifiers={[widthModifier(6)]} />
                  <ComposeText>{t('space.flow.copyInvitation')}</ComposeText>
                </OutlinedButton>
                <Spacer modifiers={[widthModifier(10)]} />
                <Button onClick={shareInvitation} modifiers={[fillMaxWidth()]}>
                  <Icon source={ICONS.space} size={18} tint={colors.onPrimary} />
                  <Spacer modifiers={[widthModifier(6)]} />
                  <ComposeText>{t('space.flow.shareInvitation')}</ComposeText>
                </Button>
              </Row>
            )}
            <TextButton onClick={() => void completeConnection()} modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('space.flow.finishLater')}</ComposeText>
            </TextButton>
          </Column>
        ) : null}

        {mode === 'success' ? (
          <Column horizontalAlignment="center" modifiers={[fillMaxWidth()]}>
            <Spacer modifiers={[heightModifier(16)]} />
            <Icon source={ICONS.ready} size={64} tint={colors.primary} />
            <Spacer modifiers={[heightModifier(16)]} />
            <ComposeText style={TITLE_STYLE}>
              {remoteDeviceName ?? t('space.flow.otherDevice')}
            </ComposeText>
            <ComposeText color={colors.onSurfaceVariant}>{t('space.flow.successBody')}</ComposeText>
            <Spacer modifiers={[heightModifier(24)]} />
            <Button onClick={() => void completeConnection()} modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('action.done', { ns: 'common' })}</ComposeText>
            </Button>
          </Column>
        ) : null}

        {error ? (
          <>
            <Spacer modifiers={[heightModifier(12)]} />
            <ComposeText color={colors.error}>{error}</ComposeText>
          </>
        ) : null}
      </Column>
    </ModalBottomSheet>
  );
}

export function AddSyncConnectionSheet(props: AddSyncConnectionSheetProps) {
  const { theme } = useTheme();

  if (!props.visible) return null;

  return (
    <Host colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.colors.accent}>
      <AddSyncConnectionSheetContent {...props} />
    </Host>
  );
}
