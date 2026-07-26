import { useEffect, useRef, useState } from 'react';
import { Share, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import type { InvitationIssued } from 'uc-engine';
import {
  BottomSheet,
  Button as SwiftUIButton,
  Group,
  Host,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  SecureField,
  type SecureFieldRef,
  Spacer,
  Text as SwiftUIText,
  TextField,
  type TextFieldRef,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  background,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  keyboardType,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  lineLimit,
  minimumScaleFactor,
  multilineTextAlignment,
  opacity,
  padding,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  shapes,
  textFieldStyle,
  textInputAutocapitalization,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSaturatedButtonPalette,
  iosSecondaryButtonModifiers,
} from '@/components/ui/iosButtonStyles.ios';
import { getUnifiedSpaceService, unifiedSpaceUserErrorCode } from '@/services/UnifiedSpaceService';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore } from '@/stores/unifiedSpaceStore';
import { hexToRgba, iosColors, iosDimensions, iosKindTints } from '@/theme/iosDesignTokens';
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

const SHEET_BACKGROUND = iosColors?.systemGroupedBackground ?? '#F2F2F7';
const CARD_BACKGROUND = iosColors?.secondarySystemGroupedBackground ?? '#FFFFFF';
const P2P_TINT = iosKindTints.text;
const JOIN_TINT = iosKindTints.group;
const SUCCESS_TINT = iosKindTints.image;
const LAN_TINT = iosKindTints.file;

function modeFromInitial(initialMode: AddSyncConnectionMode): Mode {
  return initialMode === 'join' ? 'joinCode' : initialMode;
}

function remainingTime(expiresAtMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function HeaderCircleButton({
  systemName,
  onPress,
}: {
  systemName: SFSymbol;
  onPress: () => void;
}) {
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' }),
      ]}
    >
      <Image
        systemName={systemName}
        size={18}
        modifiers={[
          font({ weight: 'semibold' }),
          padding(),
          foregroundStyle(iosColors?.secondaryLabel ?? 'secondary'),
        ]}
      />
    </SwiftUIButton>
  );
}

function InvitationActionLabel({ systemName, title }: { systemName: SFSymbol; title: string }) {
  return (
    <HStack spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
      <Spacer />
      <Image systemName={systemName} size={16} />
      <SwiftUIText modifiers={[lineLimit(1), minimumScaleFactor(0.72)]}>{title}</SwiftUIText>
      <Spacer />
    </HStack>
  );
}

function ConnectionChoice({
  title,
  description,
  systemImage,
  color,
  emphasized,
  onPress,
}: {
  title: string;
  description: string;
  systemImage: SFSymbol;
  color: string;
  emphasized?: boolean;
  onPress: () => void;
}) {
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        listRowBackground(SHEET_BACKGROUND),
        listRowSeparator('hidden'),
        listRowInsets({ top: 5, bottom: 5, leading: 16, trailing: 16 }),
      ]}
    >
      <HStack
        spacing={14}
        alignment="center"
        modifiers={[
          padding({ horizontal: 16, vertical: 16 }),
          frame({ maxWidth: Infinity }),
          background(
            emphasized ? hexToRgba(color, 0.1) : CARD_BACKGROUND,
            shapes.roundedRectangle({ cornerRadius: iosDimensions.surfaceCornerRadius })
          ),
        ]}
      >
        <HStack
          alignment="center"
          modifiers={[
            frame({ width: 44, height: 44 }),
            background(hexToRgba(color, emphasized ? 0.18 : 0.12), shapes.circle()),
          ]}
        >
          <Image systemName={systemImage} size={21} color={color} />
        </HStack>
        <VStack alignment="leading" spacing={4}>
          <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>{title}</SwiftUIText>
          <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
            {description}
          </SwiftUIText>
        </VStack>
        <Spacer />
        <Image systemName="chevron.forward" size={14} color={iosColors?.tertiaryLabel} />
      </HStack>
    </SwiftUIButton>
  );
}

function ConnectionStatus({
  localName,
  remoteName,
  complete,
}: {
  localName: string;
  remoteName: string;
  complete: boolean;
}) {
  return (
    <HStack spacing={16} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
      <VStack spacing={6} alignment="center">
        <Image systemName="iphone" size={34} color={P2P_TINT} />
        <SwiftUIText modifiers={[font({ size: 12 }), foregroundStyle('secondary')]}>
          {localName}
        </SwiftUIText>
      </VStack>
      <Spacer />
      {complete ? (
        <Image systemName="checkmark.circle.fill" size={34} color={SUCCESS_TINT} />
      ) : (
        <ProgressView />
      )}
      <Spacer />
      <VStack spacing={6} alignment="center">
        <Image
          systemName="laptopcomputer"
          size={34}
          color={complete ? SUCCESS_TINT : iosColors?.tertiaryLabel}
        />
        <SwiftUIText modifiers={[font({ size: 12 }), foregroundStyle('secondary')]}>
          {remoteName}
        </SwiftUIText>
      </VStack>
    </HStack>
  );
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
  const defaultDeviceName = resolveDefaultDeviceName(
    Device.deviceName,
    Device.modelName,
    t('space.flow.thisDevice')
  );
  const [mode, setMode] = useState<Mode>(() => modeFromInitial(initialMode));
  const [sheetDetent, setSheetDetent] = useState<PresentationDetent>('medium');
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
  const deviceNameState = useNativeState(defaultDeviceName);
  const passphraseRef = useRef<SecureFieldRef>(null);
  const space = useUnifiedSpaceStore();
  const refreshRevision = useUnifiedEngineStore((state) => state.refreshRevision);

  const errorMessage = (cause: unknown): string => {
    const code = unifiedSpaceUserErrorCode(cause);
    if (code) return t(`space.error.${code}`);
    return t('space.error.operationFailed');
  };

  const clearInputs = () => {
    const nextDeviceName = defaultDeviceName;
    setDeviceName(nextDeviceName);
    setPassphrase('');
    setInvitationCode('');
    setInvitation(null);
    setError(null);
    setCopied(false);
    deviceNameState.value = nextDeviceName;
    void passphraseRef.current?.clear();
    void invitationCodeRef.current?.clear();
  };

  const reset = () => {
    setMode(modeFromInitial(initialMode));
    clearInputs();
  };

  useEffect(() => {
    if (visible) setMode(modeFromInitial(initialMode));
  }, [initialMode, visible]);

  useEffect(() => {
    const fullHeight = mode === 'invitation' || mode === 'success';
    setSheetDetent(fullHeight ? 'large' : 'medium');
  }, [mode]);

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
    void passphraseRef.current?.clear();
    setMode(nextMode);
  };

  const updateInvitationCode = (value: string) => {
    const nextValue = invitationCodeInputValue(value);
    setInvitationCode(nextValue);
    setError(null);
    if (nextValue.length === 4 || nextValue.length === 8) void Haptics.selectionAsync();
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
      ? t('space.flow.joinCodeSheetTitle')
      : mode === 'joinDetails'
      ? t('space.flow.joinDetailsTitle')
      : mode === 'invitation'
      ? t('space.flow.waitingTitle')
      : mode === 'success'
      ? t('space.flow.successTitle')
      : t('connection.addSheetTitle');
  const canGoBack = mode === 'create' || mode === 'joinCode' || mode === 'joinDetails';

  return (
    <Host style={styles.host}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => {
          if (!presented) close();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(['medium', 'large'], {
              selection: sheetDetent,
              onSelectionChange: setSheetDetent,
            }),
            presentationDragIndicator('visible'),
          ]}
        >
          <IosSheetPage
            title={title}
            spacing={0}
            leftSlots={[
              <HeaderCircleButton
                key="leading"
                systemName={canGoBack ? 'chevron.backward' : 'xmark'}
                onPress={canGoBack ? back : close}
              />,
            ]}
            rightSlots={
              canGoBack
                ? [<HeaderCircleButton key="close" systemName="xmark" onPress={close} />]
                : undefined
            }
          >
            {mode === 'choose' ? (
              <List modifiers={[listStyle('plain'), scrollContentBackground('hidden')]}>
                <Section title={t('space.title')}>
                  <ConnectionChoice
                    title={t('space.create.title')}
                    description={t('space.create.description')}
                    systemImage="plus"
                    color={P2P_TINT}
                    emphasized
                    onPress={() => selectMode('create')}
                  />
                  <ConnectionChoice
                    title={t('space.join.title')}
                    description={t('space.join.description')}
                    systemImage="link"
                    color={JOIN_TINT}
                    onPress={() => selectMode('joinCode')}
                  />
                </Section>
                {legacyLanEligible ? (
                  <Section
                    title={t('connection.compatibilityTitle')}
                    footer={<SwiftUIText>{t('connection.lanDeprecated')}</SwiftUIText>}
                  >
                    <ConnectionChoice
                      title={t('connection.legacyLanAction')}
                      description={t('connection.legacyLanDescription')}
                      systemImage="server.rack"
                      color={LAN_TINT}
                      onPress={openLegacyLan}
                    />
                  </Section>
                ) : null}
              </List>
            ) : null}

            {mode === 'create' ? (
              <IosSheetForm>
                <Section footer={<SwiftUIText>{t('space.flow.createBody')}</SwiftUIText>}>
                  <TextField
                    text={deviceNameState}
                    placeholder={t('space.field.deviceName')}
                    onTextChange={setDeviceName}
                    modifiers={[
                      textFieldStyle('plain'),
                      textInputAutocapitalization('words'),
                      frame({ minHeight: 30 }),
                    ]}
                  />
                  <SecureField
                    ref={passphraseRef}
                    placeholder={t('space.field.passphrase')}
                    onTextChange={setPassphrase}
                    modifiers={[frame({ minHeight: 30 })]}
                  />
                </Section>
                <SwiftUIButton
                  onPress={submitCreate}
                  modifiers={[
                    ...iosProminentButtonModifiers(iosSaturatedButtonPalette(P2P_TINT), {
                      fullWidth: true,
                    }),
                    controlSize('large'),
                    disabled(!canSubmitDetails || pending),
                    opacity(!canSubmitDetails || pending ? 0.32 : 1),
                    listRowBackground(SHEET_BACKGROUND),
                    listRowSeparator('hidden'),
                    listRowInsets({ top: 8, bottom: 8, leading: 16, trailing: 16 }),
                  ]}
                >
                  <HStack spacing={8} modifiers={[frame({ minHeight: 48, maxWidth: Infinity })]}>
                    <Spacer />
                    {pending ? <ProgressView /> : <Image systemName="plus.circle.fill" size={17} />}
                    <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                      {t('space.create.action')}
                    </SwiftUIText>
                    <Spacer />
                  </HStack>
                </SwiftUIButton>
              </IosSheetForm>
            ) : null}

            {mode === 'joinCode' ? (
              <IosSheetForm>
                <Section footer={<SwiftUIText>{t('space.flow.joinCodeBody')}</SwiftUIText>}>
                  <TextField
                    ref={invitationCodeRef}
                    placeholder="XXXXXXXX"
                    onTextChange={updateInvitationCode}
                    maxLength={8}
                    autoFocus
                    modifiers={[
                      textFieldStyle('plain'),
                      keyboardType('ascii-capable'),
                      autocorrectionDisabled(),
                      textInputAutocapitalization('characters'),
                      multilineTextAlignment('center'),
                      font({ size: 28, weight: 'semibold', design: 'monospaced' }),
                      frame({ minHeight: 54, maxWidth: Infinity }),
                    ]}
                  />
                </Section>
                <SwiftUIButton
                  onPress={continueFromCode}
                  modifiers={[
                    ...iosProminentButtonModifiers(iosSaturatedButtonPalette(JOIN_TINT), {
                      fullWidth: true,
                    }),
                    controlSize('large'),
                    disabled(!codeComplete),
                    opacity(codeComplete ? 1 : 0.32),
                    listRowBackground(SHEET_BACKGROUND),
                    listRowSeparator('hidden'),
                    listRowInsets({ top: 8, bottom: 8, leading: 16, trailing: 16 }),
                  ]}
                >
                  <HStack modifiers={[frame({ minHeight: 48, maxWidth: Infinity })]}>
                    <Spacer />
                    <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                      {t('space.flow.continue')}
                    </SwiftUIText>
                    <Spacer />
                  </HStack>
                </SwiftUIButton>
              </IosSheetForm>
            ) : null}

            {mode === 'joinDetails' ? (
              <IosSheetForm>
                <Section
                  header={
                    <SwiftUIText
                      modifiers={[font({ size: 20, weight: 'semibold', design: 'monospaced' })]}
                    >
                      {formatInvitationCode(normalizeInvitationCodeInput(invitationCode))}
                    </SwiftUIText>
                  }
                  footer={<SwiftUIText>{t('space.flow.joinDetailsBody')}</SwiftUIText>}
                >
                  <SecureField
                    ref={passphraseRef}
                    placeholder={t('space.field.passphrase')}
                    onTextChange={setPassphrase}
                    autoFocus
                    modifiers={[frame({ minHeight: 30 })]}
                  />
                  <TextField
                    text={deviceNameState}
                    placeholder={t('space.field.deviceName')}
                    onTextChange={setDeviceName}
                    modifiers={[
                      textFieldStyle('plain'),
                      textInputAutocapitalization('words'),
                      frame({ minHeight: 30 }),
                    ]}
                  />
                </Section>
                <SwiftUIButton
                  onPress={submitJoin}
                  modifiers={[
                    ...iosProminentButtonModifiers(iosSaturatedButtonPalette(JOIN_TINT), {
                      fullWidth: true,
                    }),
                    controlSize('large'),
                    disabled(!canSubmitDetails || pending),
                    opacity(!canSubmitDetails || pending ? 0.32 : 1),
                    listRowBackground(SHEET_BACKGROUND),
                    listRowSeparator('hidden'),
                    listRowInsets({ top: 8, bottom: 8, leading: 16, trailing: 16 }),
                  ]}
                >
                  <HStack spacing={8} modifiers={[frame({ minHeight: 48, maxWidth: Infinity })]}>
                    <Spacer />
                    {pending ? <ProgressView /> : <Image systemName="link.circle.fill" size={17} />}
                    <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                      {t('space.join.action')}
                    </SwiftUIText>
                    <Spacer />
                  </HStack>
                </SwiftUIButton>
              </IosSheetForm>
            ) : null}

            {mode === 'invitation' && invitation ? (
              <IosSheetForm>
                <Section footer={<SwiftUIText>{t('space.flow.waitingBody')}</SwiftUIText>}>
                  <ConnectionStatus
                    localName={deviceName}
                    remoteName={t('space.flow.otherDevice')}
                    complete={false}
                  />
                  <SwiftUIText
                    modifiers={[
                      foregroundStyle(P2P_TINT),
                      frame({ maxWidth: Infinity }),
                      multilineTextAlignment('center'),
                    ]}
                  >
                    {t('space.flow.waitingForDevice')}
                  </SwiftUIText>
                </Section>
                <Section>
                  <SwiftUIText
                    modifiers={[
                      font({ size: 30, weight: 'bold', design: 'monospaced' }),
                      frame({ maxWidth: Infinity }),
                      multilineTextAlignment('center'),
                    ]}
                  >
                    {invitation.invitationCode}
                  </SwiftUIText>
                  <HStack spacing={7}>
                    <Image systemName="clock" size={15} />
                    <SwiftUIText
                      modifiers={[foregroundStyle(invitationExpired ? 'red' : 'secondary')]}
                    >
                      {invitationExpired
                        ? t('space.flow.expired')
                        : t('space.flow.expiresIn', {
                            time: remainingTime(invitation.expiresAtMs, nowMs),
                          })}
                    </SwiftUIText>
                  </HStack>
                  <HStack spacing={7}>
                    <Image
                      systemName={
                        invitation.availability === 'sameLocalNetwork' ? 'wifi' : 'network'
                      }
                      size={15}
                    />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t(
                        invitation.availability === 'sameLocalNetwork'
                          ? 'space.invitation.sameLocalNetwork'
                          : 'space.invitation.crossNetwork'
                      )}
                    </SwiftUIText>
                  </HStack>
                </Section>
                <Section>
                  {invitationExpired ? (
                    <SwiftUIButton
                      onPress={renewInvitation}
                      modifiers={[
                        ...iosProminentButtonModifiers(iosSaturatedButtonPalette(P2P_TINT), {
                          fullWidth: true,
                        }),
                        controlSize('large'),
                      ]}
                    >
                      <SwiftUIText>{t('space.invitation.action')}</SwiftUIText>
                    </SwiftUIButton>
                  ) : (
                    <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
                      <SwiftUIButton
                        onPress={copyInvitation}
                        modifiers={[...iosSecondaryButtonModifiers(), controlSize('large')]}
                      >
                        <InvitationActionLabel
                          systemName={copied ? 'checkmark' : 'doc.on.doc'}
                          title={t('space.flow.copyInvitation')}
                        />
                      </SwiftUIButton>
                      <SwiftUIButton
                        onPress={shareInvitation}
                        modifiers={[
                          ...iosProminentButtonModifiers(iosSaturatedButtonPalette(P2P_TINT)),
                          controlSize('large'),
                        ]}
                      >
                        <InvitationActionLabel
                          systemName="square.and.arrow.up"
                          title={t('space.flow.shareInvitation')}
                        />
                      </SwiftUIButton>
                    </HStack>
                  )}
                  <SwiftUIButton
                    onPress={() => void completeConnection()}
                    modifiers={[buttonStyle('plain')]}
                  >
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t('space.flow.finishLater')}
                    </SwiftUIText>
                  </SwiftUIButton>
                </Section>
              </IosSheetForm>
            ) : null}

            {mode === 'success' ? (
              <IosSheetForm>
                <Section>
                  <ConnectionStatus
                    localName={deviceName}
                    remoteName={remoteDevice?.displayName ?? t('space.flow.otherDevice')}
                    complete
                  />
                  <VStack
                    spacing={5}
                    alignment="center"
                    modifiers={[frame({ maxWidth: Infinity })]}
                  >
                    <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                      {t('space.flow.successTitle')}
                    </SwiftUIText>
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t('space.flow.successBody')}
                    </SwiftUIText>
                  </VStack>
                </Section>
                <Section>
                  <SwiftUIButton
                    onPress={() => void completeConnection()}
                    modifiers={[
                      ...iosProminentButtonModifiers(iosSaturatedButtonPalette(SUCCESS_TINT), {
                        fullWidth: true,
                      }),
                      controlSize('large'),
                    ]}
                  >
                    <HStack modifiers={[frame({ minHeight: 48, maxWidth: Infinity })]}>
                      <Spacer />
                      <Image systemName="checkmark.circle.fill" size={17} />
                      <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                        {t('action.done', { ns: 'common' })}
                      </SwiftUIText>
                      <Spacer />
                    </HStack>
                  </SwiftUIButton>
                </Section>
              </IosSheetForm>
            ) : null}

            {error ? (
              <IosSheetForm>
                <Section>
                  <HStack spacing={8}>
                    <Image systemName="exclamationmark.circle.fill" size={17} color="#FF3B30" />
                    <SwiftUIText modifiers={[foregroundStyle('red')]}>{error}</SwiftUIText>
                  </HStack>
                </Section>
              </IosSheetForm>
            ) : null}
          </IosSheetPage>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 0, height: 0 },
});
