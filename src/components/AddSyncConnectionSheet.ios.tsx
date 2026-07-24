import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  BottomSheet,
  Button as SwiftUIButton,
  Group,
  Host,
  HStack,
  Image,
  LabeledContent,
  List,
  SecureField,
  type SecureFieldRef,
  Section,
  Spacer,
  Text as SwiftUIText,
  TextField,
  type TextFieldRef,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  opacity,
  padding,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  shapes,
  textFieldStyle,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { getUnifiedSpaceService } from '@/services/UnifiedSpaceService';
import { hexToRgba, iosColors, iosKindTints } from '@/theme/iosDesignTokens';
import type { InvitationIssued } from 'uc-engine';
import type { AddSyncConnectionSheetProps } from './AddSyncConnectionSheet.types';

type Mode = 'choose' | 'create' | 'join' | 'invitation';

const SHEET_BACKGROUND = iosColors?.systemGroupedBackground ?? '#F2F2F7';
const CARD_BACKGROUND = iosColors?.secondarySystemGroupedBackground ?? '#FFFFFF';
const P2P_TINT = iosKindTints.text;
const LAN_TINT = iosKindTints.file;

function headerCircleButton(key: string, systemName: SFSymbol, onPress: () => void) {
  return (
    <SwiftUIButton
      key={key}
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

function ConnectionChoiceCard({
  title,
  description,
  systemImage,
  tint,
  emphasized = false,
  onPress,
}: {
  title: string;
  description: string;
  systemImage: SFSymbol;
  tint: string;
  emphasized?: boolean;
  onPress: () => void;
}) {
  const fill = emphasized ? hexToRgba(tint, 0.1) : CARD_BACKGROUND;

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
          background(fill, shapes.roundedRectangle({ cornerRadius: 14 })),
        ]}
      >
        <HStack
          alignment="center"
          modifiers={[
            frame({ width: 44, height: 44 }),
            background(hexToRgba(tint, emphasized ? 0.18 : 0.12), shapes.circle()),
          ]}
        >
          <Image systemName={systemImage} size={21} color={tint} />
        </HStack>
        <VStack alignment="leading" spacing={4}>
          <SwiftUIText
            modifiers={[
              font({ size: 17, weight: 'semibold' }),
              foregroundStyle(iosColors?.label ?? 'primary'),
            ]}
          >
            {title}
          </SwiftUIText>
          <SwiftUIText
            modifiers={[
              font({ size: 13 }),
              foregroundStyle(iosColors?.secondaryLabel ?? 'secondary'),
            ]}
          >
            {description}
          </SwiftUIText>
        </VStack>
        <Spacer />
        <Image
          systemName="chevron.forward"
          size={14}
          modifiers={[foregroundStyle({ type: 'hierarchical', style: 'tertiary' })]}
        />
      </HStack>
    </SwiftUIButton>
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

  const clearInputs = () => {
    setDeviceName('');
    setPassphrase('');
    setInvitationCode('');
    setInvitation(null);
    void deviceNameRef.current?.clear();
    void passphraseRef.current?.clear();
    void invitationCodeRef.current?.clear();
  };

  const reset = () => {
    setMode(initialMode);
    clearInputs();
    setError(null);
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

  const backToChoose = () => {
    clearInputs();
    setError(null);
    setMode('choose');
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

  const canSubmit =
    deviceName.trim().length > 0 &&
    passphrase.trim().length > 0 &&
    (mode !== 'join' || invitationCode.trim().length > 0);

  const submit = async () => {
    if (!canSubmit || pending || (mode !== 'create' && mode !== 'join')) return;
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

  const title =
    mode === 'create'
      ? t('space.create.action')
      : mode === 'join'
      ? t('space.join.action')
      : mode === 'invitation'
      ? t('space.invitation.title')
      : t('connection.addSheetTitle');

  const leadingButton =
    mode === 'create' || mode === 'join'
      ? headerCircleButton('back', 'chevron.backward', backToChoose)
      : headerCircleButton('close', 'xmark', close);
  const trailingButton =
    mode === 'create' || mode === 'join' ? headerCircleButton('close', 'xmark', close) : undefined;

  return (
    <Host style={styles.host}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => {
          if (!presented) close();
        }}
      >
        <Group modifiers={[presentationDetents(['medium']), presentationDragIndicator('visible')]}>
          <IosSheetPage
            title={title}
            spacing={0}
            leftSlots={[leadingButton]}
            rightSlots={trailingButton ? [trailingButton] : undefined}
          >
            {mode === 'choose' ? (
              <List modifiers={[listStyle('plain'), scrollContentBackground('hidden')]}>
                <Section title={t('space.title')}>
                  <ConnectionChoiceCard
                    title={t('space.create.title')}
                    description={t('space.create.description')}
                    systemImage="plus"
                    tint={P2P_TINT}
                    emphasized
                    onPress={() => setMode('create')}
                  />
                  <ConnectionChoiceCard
                    title={t('space.join.title')}
                    description={t('space.join.description')}
                    systemImage="link"
                    tint={iosKindTints.group}
                    onPress={() => setMode('join')}
                  />
                </Section>

                {legacyLanEligible ? (
                  <Section
                    title={t('connection.compatibilityTitle')}
                    footer={<SwiftUIText>{t('connection.lanDeprecated')}</SwiftUIText>}
                  >
                    <ConnectionChoiceCard
                      title={t('connection.legacyLanAction')}
                      description={t('connection.legacyLanDescription')}
                      systemImage="server.rack"
                      tint={LAN_TINT}
                      onPress={openLegacyLan}
                    />
                  </Section>
                ) : null}
              </List>
            ) : null}

            {mode === 'create' || mode === 'join' ? (
              <IosSheetForm>
                <Section footer={<SwiftUIText>{t('space.footer')}</SwiftUIText>}>
                  {mode === 'join' ? (
                    <TextField
                      ref={invitationCodeRef}
                      placeholder={t('space.field.invitationCode')}
                      onTextChange={setInvitationCode}
                      modifiers={[textFieldStyle('plain'), frame({ minHeight: 26 })]}
                    />
                  ) : null}
                  <TextField
                    ref={deviceNameRef}
                    placeholder={t('space.field.deviceName')}
                    onTextChange={setDeviceName}
                    modifiers={[textFieldStyle('plain'), frame({ minHeight: 26 })]}
                  />
                  <SecureField
                    ref={passphraseRef}
                    placeholder={t('space.field.passphrase')}
                    onTextChange={setPassphrase}
                    modifiers={[frame({ minHeight: 26 })]}
                  />
                </Section>

                {error ? (
                  <Section>
                    <HStack spacing={8}>
                      <Image systemName="exclamationmark.circle.fill" size={17} color="#FF3B30" />
                      <SwiftUIText modifiers={[foregroundStyle('red')]}>{error}</SwiftUIText>
                    </HStack>
                  </Section>
                ) : null}

                <Section>
                  <SwiftUIButton
                    onPress={submit}
                    modifiers={[
                      buttonStyle('borderedProminent'),
                      controlSize('large'),
                      tint(mode === 'create' ? P2P_TINT : iosKindTints.group),
                      listRowBackground('transparent'),
                      listRowInsets({ top: 6, bottom: 6, leading: 0, trailing: 0 }),
                      disabled(!canSubmit || pending),
                      opacity(!canSubmit || pending ? 0.32 : 1),
                    ]}
                  >
                    <HStack
                      spacing={8}
                      modifiers={[
                        frame({ minHeight: 50, maxWidth: Infinity }),
                        foregroundStyle('#FFFFFF'),
                      ]}
                    >
                      <Spacer />
                      <Image
                        systemName={mode === 'create' ? 'plus.circle.fill' : 'link.circle.fill'}
                        size={16}
                      />
                      <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                        {pending ? t('space.working') : t(`space.${mode}.action`)}
                      </SwiftUIText>
                      <Spacer />
                    </HStack>
                  </SwiftUIButton>
                </Section>
              </IosSheetForm>
            ) : null}

            {mode === 'invitation' && invitation ? (
              <IosSheetForm>
                <Section title={t('space.invitation.description')}>
                  <LabeledContent label={t('space.invitation.code')}>
                    <SwiftUIText modifiers={[font({ size: 20, weight: 'semibold' })]}>
                      {invitation.invitationCode}
                    </SwiftUIText>
                  </LabeledContent>
                  <HStack spacing={8}>
                    <Image systemName="clock" size={15} />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t('connection.invitationExpires', {
                        time: new Date(invitation.expiresAtMs).toLocaleTimeString(),
                      })}
                    </SwiftUIText>
                  </HStack>
                </Section>
                <Section>
                  <SwiftUIButton
                    onPress={() => void completeConnection()}
                    modifiers={[buttonStyle('borderedProminent'), controlSize('large')]}
                  >
                    <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
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
          </IosSheetPage>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 0, height: 0 },
});
