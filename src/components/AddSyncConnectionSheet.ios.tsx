import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import * as Device from 'expo-device';
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
import { hexToRgba, iosColors, iosDimensions, iosKindTints } from '@/theme/iosDesignTokens';
import { resolveDefaultDeviceName } from '@/utils/deviceName';
import { formatInvitationCode, normalizeInvitationCodeInput } from '@/utils/invitationCode';
import type { AddSyncConnectionSheetProps } from './AddSyncConnectionSheet.types';
import { useAddSyncConnectionFlow } from './useAddSyncConnectionFlow';

const SHEET_BACKGROUND = iosColors?.systemGroupedBackground ?? '#F2F2F7';
const CARD_BACKGROUND = iosColors?.secondarySystemGroupedBackground ?? '#FFFFFF';
const P2P_TINT = iosKindTints.text;
const JOIN_TINT = iosKindTints.group;
const SUCCESS_TINT = iosKindTints.image;

function ConnectionSheetHost({ embedded, children }: { embedded: boolean; children: ReactNode }) {
  return embedded ? <Group>{children}</Group> : <Host style={styles.host}>{children}</Host>;
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
  initialMode = 'choose',
  embeddedInHost = false,
  onClose,
  onConnected,
}: AddSyncConnectionSheetProps) {
  const { t } = useTranslation('settingsSync');
  const defaultDeviceName = resolveDefaultDeviceName(
    Device.deviceName,
    Device.modelName,
    t('space.flow.thisDevice')
  );
  const [sheetDetent, setSheetDetent] = useState<PresentationDetent>('medium');
  const invitationCodeRef = useRef<TextFieldRef>(null);
  const deviceNameState = useNativeState(defaultDeviceName);
  const passphraseRef = useRef<SecureFieldRef>(null);
  const { state, actions } = useAddSyncConnectionFlow({
    visible,
    initialMode,
    defaultDeviceName,
    onClose,
    onConnected,
    resetNativeFields: (nextDeviceName) => {
      deviceNameState.value = nextDeviceName;
      void passphraseRef.current?.clear();
      void invitationCodeRef.current?.clear();
    },
    clearNativePassphrase: () => {
      void passphraseRef.current?.clear();
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

  useEffect(() => {
    const fullHeight = mode === 'invitation' || mode === 'success';
    setSheetDetent(fullHeight ? 'large' : 'medium');
  }, [mode]);
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
    <ConnectionSheetHost embedded={embeddedInHost}>
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
                            time: invitationTimeRemaining,
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
                    remoteName={remoteDeviceName ?? t('space.flow.otherDevice')}
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
    </ConnectionSheetHost>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 0, height: 0 },
});
