import { useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import type { InvitationIssued } from 'uc-engine';
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

import { getUnifiedSpaceService, unifiedSpaceUserErrorCode } from '@/services/UnifiedSpaceService';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore } from '@/stores/unifiedSpaceStore';
import { resolveDefaultDeviceName } from '@/utils/deviceName';
import {
  formatInvitationCode,
  invitationCodeInputValue,
  isInvitationCodeComplete,
  normalizeInvitationCodeInput,
} from '@/utils/invitationCode';
import type {
  AddSyncConnectionMode,
  AddSyncConnectionSheetProps,
} from './AddSyncConnectionSheet.types';

type Mode = 'choose' | 'create' | 'joinCode' | 'joinDetails' | 'invitation' | 'success';

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

function modeFromInitial(initialMode: AddSyncConnectionMode): Mode {
  return initialMode === 'join' ? 'joinCode' : initialMode;
}

function remainingTime(expiresAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

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
  const defaultDeviceName = resolveDefaultDeviceName(
    Device.deviceName,
    Device.modelName,
    t('space.flow.thisDevice')
  );
  const [mode, setMode] = useState<Mode>(() => modeFromInitial(initialMode));
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [passphrase, setPassphrase] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const mountedRef = useRef(true);
  const invitationCodeRef = useRef<TextFieldRef>(null);
  const deviceNameState = useNativeState(deviceName);
  const passphraseState = useNativeState(passphrase);
  const invitationCodeState = useNativeState('');
  const space = useUnifiedSpaceStore();
  const refreshRevision = useUnifiedEngineStore((state) => state.refreshRevision);

  const errorMessage = (cause: unknown): string => {
    const code = unifiedSpaceUserErrorCode(cause);
    if (code) return t(`space.error.${code}`);
    return t('space.error.operationFailed');
  };

  const reset = () => {
    const nextDeviceName = defaultDeviceName;
    setMode(modeFromInitial(initialMode));
    setDeviceName(nextDeviceName);
    setPassphrase('');
    setInvitationCode('');
    setInvitation(null);
    setError(null);
    setCopied(false);
    deviceNameState.value = nextDeviceName;
    passphraseState.value = '';
    invitationCodeState.value = '';
  };

  useEffect(() => {
    if (visible) setMode(modeFromInitial(initialMode));
  }, [initialMode, visible]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!visible || mode !== 'invitation') return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [mode, visible]);

  useEffect(() => {
    if (!visible || mode !== 'invitation') return;
    void getUnifiedSpaceService()
      .refresh()
      .then((snapshot) => {
        if (!mountedRef.current || !snapshot.devices.some((device) => !device.isLocal)) return;
        setMode('success');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      })
      .catch(() => undefined);
  }, [mode, refreshRevision, visible]);

  const completeConnection = async () => {
    if ((await onConnected?.()) === false) return;
    if (!mountedRef.current) return;
    reset();
    onClose();
  };

  const close = () => {
    if (pending) return;
    if (mode === 'invitation' || mode === 'success') {
      void completeConnection();
      return;
    }
    reset();
    onClose();
  };

  const openLegacyLan = () => {
    reset();
    onClose();
    onOpenLegacyLan();
  };

  const back = () => {
    setError(null);
    if (mode === 'joinDetails') {
      setMode('joinCode');
      return;
    }
    if (initialMode === 'choose') {
      setMode('choose');
      return;
    }
    close();
  };

  const selectMode = (nextMode: 'create' | 'joinCode') => {
    setError(null);
    setPassphrase('');
    passphraseState.value = '';
    setMode(nextMode);
  };

  const updateInvitationCode = (value: string) => {
    const nextValue = invitationCodeInputValue(value);
    setInvitationCode(nextValue);
    setError(null);
    if (nextValue.length === 4 || nextValue.length === 8) {
      void Haptics.selectionAsync();
    }
  };

  const continueFromCode = () => {
    if (!isInvitationCodeComplete(invitationCode)) {
      setError(t('space.error.invitationCodeInvalid'));
      return;
    }
    setError(null);
    setMode('joinDetails');
  };

  const submitCreate = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const created = await getUnifiedSpaceService().createSpace(deviceName, passphrase);
      setInvitation(created.invitation);
      setNowMs(Date.now());
      setMode('invitation');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const submitJoin = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await getUnifiedSpaceService().joinSpace(
        formatInvitationCode(invitationCode),
        deviceName,
        passphrase
      );
      setMode('success');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const renewInvitation = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      setInvitation(await getUnifiedSpaceService().issueInvitation());
      setNowMs(Date.now());
      setCopied(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const copyInvitation = async () => {
    if (!invitation) return;
    await Clipboard.setStringAsync(invitation.invitationCode);
    setCopied(true);
    void Haptics.selectionAsync();
  };

  const shareInvitation = async () => {
    if (!invitation) return;
    await Share.share({
      message: t('space.flow.shareMessage', { code: invitation.invitationCode }),
    });
  };

  const canSubmitDetails = deviceName.trim().length > 0 && passphrase.trim().length > 0;
  const codeComplete = isInvitationCodeComplete(invitationCode);
  const invitationExpired = invitation ? invitation.expiresAtMs <= nowMs : false;
  const remoteDevice = space.devices.find((device) => !device.isLocal);
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
    <Host>
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

          {mode === 'create' ? (
            <Column modifiers={[fillMaxWidth()]}>
              <ComposeText color={colors.onSurfaceVariant}>
                {t('space.flow.createBody')}
              </ComposeText>
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
              <Button
                onClick={continueFromCode}
                enabled={codeComplete}
                modifiers={[fillMaxWidth()]}
              >
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
              <ComposeText color={colors.onSurfaceVariant}>
                {t('space.flow.waitingBody')}
              </ComposeText>
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
                      time: remainingTime(invitation.expiresAtMs, nowMs),
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
                {remoteDevice?.displayName ?? t('space.flow.otherDevice')}
              </ComposeText>
              <ComposeText color={colors.onSurfaceVariant}>
                {t('space.flow.successBody')}
              </ComposeText>
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
    </Host>
  );
}
