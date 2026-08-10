import { useEffect, useRef } from 'react';
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
  Shape,
  Spacer,
  Surface,
  Text as ComposeText,
  TextButton,
  type ModalBottomSheetRef,
  type TextFieldRef,
  useMaterialColors,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height as heightModifier,
  padding,
  paddingAll,
  verticalScroll,
  weight,
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
  share: require('../assets/icons/share.xml'),
  clock: require('../assets/icons/clock.xml'),
  wifi: require('../assets/icons/wifi.xml'),
  public: require('../assets/icons/public.xml'),
};

const TITLE_STYLE = { typography: 'titleLarge' } as const;
const CODE_REVIEW_STYLE = { typography: 'headlineMedium' } as const;
const INVITATION_STYLE = {
  typography: 'displaySmall',
  fontFamily: 'monospace',
  fontWeight: '700',
  letterSpacing: 0,
  textAlign: 'center',
} as const;
const CODE_INPUT_STYLE = {
  textAlign: 'center',
  fontFamily: 'monospace',
  fontSize: 28,
  fontWeight: '600',
  letterSpacing: 0,
} as const;
const DEVICE_NAME_STYLE = { fontSize: 12, textAlign: 'center' } as const;
const WAITING_STYLE = { textAlign: 'center' } as const;
const CARD_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 24, topEnd: 24, bottomStart: 24, bottomEnd: 24 },
});

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

  const sheetRef = useRef<ModalBottomSheetRef>(null);

  useEffect(() => {
    if (!visible) return;
    if (mode === 'invitation') {
      void sheetRef.current?.expand();
    } else if (mode === 'success') {
      void sheetRef.current?.partialExpand();
    }
  }, [mode, visible]);

  if (!visible) return null;

  return (
    <ModalBottomSheet ref={sheetRef} onDismissRequest={close}>
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
            <Surface
              color={colors.surfaceContainerHigh}
              shape={CARD_SHAPE}
              modifiers={[fillMaxWidth()]}
            >
              <Column
                horizontalAlignment="center"
                modifiers={[fillMaxWidth(), padding(20, 16, 20, 20)]}
              >
                <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
                  <Column horizontalAlignment="center" modifiers={[weight(1)]}>
                    <Icon source={ICONS.device} size={36} tint={colors.primary} />
                    <Spacer modifiers={[heightModifier(8)]} />
                    <ComposeText style={DEVICE_NAME_STYLE} maxLines={1}>
                      {deviceName}
                    </ComposeText>
                  </Column>
                  <CircularProgressIndicator modifiers={[widthModifier(30), heightModifier(30)]} />
                  <Column horizontalAlignment="center" modifiers={[weight(1)]}>
                    <Icon source={ICONS.device} size={36} tint={colors.outline} />
                    <Spacer modifiers={[heightModifier(8)]} />
                    <ComposeText
                      style={DEVICE_NAME_STYLE}
                      color={colors.onSurfaceVariant}
                      maxLines={1}
                    >
                      {t('space.flow.otherDevice')}
                    </ComposeText>
                  </Column>
                </Row>
                <Spacer modifiers={[heightModifier(14)]} />
                <ComposeText color={colors.primary} style={WAITING_STYLE}>
                  {t('space.flow.waitingForDevice')}
                </ComposeText>
                <Spacer modifiers={[heightModifier(4)]} />
                <ComposeText color={colors.onSurfaceVariant} style={WAITING_STYLE}>
                  {t('space.flow.waitingBody')}
                </ComposeText>
              </Column>
            </Surface>

            <Spacer modifiers={[heightModifier(16)]} />

            <Surface
              color={colors.surfaceContainerHigh}
              shape={CARD_SHAPE}
              modifiers={[fillMaxWidth()]}
            >
              <Column
                horizontalAlignment="center"
                modifiers={[fillMaxWidth(), padding(20, 16, 20, 20)]}
              >
                <ComposeText style={INVITATION_STYLE}>{invitation.invitationCode}</ComposeText>
                <Spacer modifiers={[heightModifier(14)]} />
                <Row verticalAlignment="center">
                  <Icon
                    source={ICONS.clock}
                    size={16}
                    tint={invitationExpired ? colors.error : colors.onSurfaceVariant}
                  />
                  <Spacer modifiers={[widthModifier(6)]} />
                  <ComposeText color={invitationExpired ? colors.error : colors.onSurfaceVariant}>
                    {invitationExpired
                      ? t('space.flow.expired')
                      : t('space.flow.expiresIn', {
                          time: invitationTimeRemaining,
                        })}
                  </ComposeText>
                </Row>
                <Spacer modifiers={[heightModifier(6)]} />
                <Row verticalAlignment="center">
                  <Icon
                    source={
                      invitation.availability === 'sameLocalNetwork' ? ICONS.wifi : ICONS.public
                    }
                    size={16}
                    tint={colors.onSurfaceVariant}
                  />
                  <Spacer modifiers={[widthModifier(6)]} />
                  <ComposeText color={colors.onSurfaceVariant}>
                    {t(
                      invitation.availability === 'sameLocalNetwork'
                        ? 'space.invitation.sameLocalNetwork'
                        : 'space.invitation.crossNetwork'
                    )}
                  </ComposeText>
                </Row>
              </Column>
            </Surface>

            <Spacer modifiers={[heightModifier(20)]} />
            {invitationExpired ? (
              <Button onClick={renewInvitation} enabled={!pending} modifiers={[fillMaxWidth()]}>
                <ComposeText>{t('space.invitation.action')}</ComposeText>
              </Button>
            ) : (
              <Row modifiers={[fillMaxWidth()]}>
                <OutlinedButton onClick={copyInvitation} modifiers={[weight(1)]}>
                  <Icon
                    source={copied ? ICONS.ready : ICONS.copy}
                    size={18}
                    tint={colors.primary}
                  />
                  <Spacer modifiers={[widthModifier(6)]} />
                  <ComposeText>{t('space.flow.copyInvitation')}</ComposeText>
                </OutlinedButton>
                <Spacer modifiers={[widthModifier(10)]} />
                <Button onClick={shareInvitation} modifiers={[weight(1)]}>
                  <Icon source={ICONS.share} size={18} tint={colors.onPrimary} />
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
