import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  type ColorValue,
  type NativeSyntheticEvent,
} from 'react-native';
import * as Device from 'expo-device';
import { requireNativeView } from 'expo';
import {
  BottomSheet,
  Button as SwiftUIButton,
  Group,
  Host,
  HStack,
  Image,
  List,
  ScrollView,
  Section,
  SecureField,
  type SecureFieldRef,
  Spacer,
  Text as SwiftUIText,
  TextField,
  type TextFieldRef,
  useNativeState,
  VStack,
  ZStack,
  type BottomSheetProps,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  autocorrectionDisabled,
  background,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  keyboardType,
  interactiveDismissDisabled,
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
  symbolEffect,
  textFieldStyle,
  textInputAutocapitalization,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage, IosSheetScaffold } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSaturatedButtonPalette,
  iosSecondaryButtonModifiers,
} from '@/components/ui/iosButtonStyles.ios';
import {
  hexToRgba,
  iosAccent,
  iosAccentColor,
  iosColors,
  iosDimensions,
  iosKindTints,
} from '@/theme/iosDesignTokens';
import { resolveDefaultDeviceName } from '@/utils/deviceName';
import * as ClipboardProxy from '@/utils/clipboardProxy';
import {
  formatInvitationCode,
  invitationCodeInputValue,
  normalizeInvitationCodeInput,
} from '@/utils/invitationCode';
import type { AddSyncConnectionSheetProps } from './AddSyncConnectionSheet.types';
import { useAddSyncConnectionFlow } from './useAddSyncConnectionFlow';
import { useAddSyncConnectionPreviewFlow } from '@/devtools/useAddSyncConnectionPreviewFlow';

const SHEET_BACKGROUND = iosColors?.systemGroupedBackground ?? '#F2F2F7';
const CARD_BACKGROUND =
  iosColors?.secondarySystemGroupedBackground ?? '#FFFFFF';
const P2P_TINT = iosKindTints.text;
const JOIN_TINT = iosAccentColor ?? iosAccent.light;
const SUCCESS_TINT = iosKindTints.image;
const ATTENTION_TINT = '#FF9500';
const ERROR_TINT = '#FF3B30';
const NEUTRAL_TINT = '#8E8E93';

function ConnectionSheetHost({
  embedded,
  children,
}: {
  embedded: boolean;
  children: ReactNode;
}) {
  return embedded ? <Group>{children}</Group> : <Host style={styles.host}>{children}</Host>;
}

type NativeBottomSheetProps = Omit<
  BottomSheetProps,
  'onIsPresentedChange' | 'onDismiss'
> & {
  onIsPresentedChange: (
    event: NativeSyntheticEvent<{ isPresented: boolean }>
  ) => void;
  onDismiss: () => void;
  onGlobalEvent?: (
    event: NativeSyntheticEvent<Record<string, unknown>>
  ) => void;
};

const PersistentBottomSheetNativeView =
  requireNativeView<NativeBottomSheetProps>('ExpoUI', 'BottomSheetView');

function PersistentBottomSheet({
  modifiers,
  onIsPresentedChange,
  onDismiss,
  ...restProps
}: BottomSheetProps) {
  const modifierListeners = new Map<string, (value: unknown) => void>();

  for (const modifier of modifiers ?? []) {
    if (modifier.eventListener)
      modifierListeners.set(modifier.$type, modifier.eventListener);
  }

  return (
    <PersistentBottomSheetNativeView
      modifiers={modifiers}
      {...restProps}
      onGlobalEvent={({ nativeEvent }) => {
        for (const [eventName, value] of Object.entries(nativeEvent)) {
          modifierListeners.get(eventName)?.(value);
        }
      }}
      onIsPresentedChange={({ nativeEvent: { isPresented } }) =>
        onIsPresentedChange(isPresented)
      }
      onDismiss={() => onDismiss?.()}
    />
  );
}

function HeaderCircleButton({
  systemName,
  onPress,
  isDisabled = false,
}: {
  systemName: SFSymbol;
  onPress: () => void;
  isDisabled?: boolean;
}) {
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        disabled(isDisabled),
        glassEffect({
          glass: { variant: 'regular', interactive: true },
          shape: 'circle',
        }),
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

function InvitationCodeField({
  code,
  inputRef,
  label,
  nativeText,
  onTextChange,
}: {
  code: string;
  inputRef: React.RefObject<TextFieldRef | null>;
  label: string;
  nativeText: NonNullable<React.ComponentProps<typeof TextField>['text']>;
  onTextChange: (value: string) => void;
}) {
  const normalizedCode = normalizeInvitationCodeInput(code);
  const codeCells = Array.from({ length: 6 }, (_, index) => index);
  const groups = [codeCells.slice(0, 3), codeCells.slice(3, 6)];

  return (
    <VStack spacing={4} modifiers={[frame({ maxWidth: Infinity })]}>
      <SwiftUIButton
        onPress={() => inputRef.current?.focus()}
        modifiers={[buttonStyle('plain'), accessibilityLabel(label)]}
      >
        <HStack spacing={10} alignment="center">
          {groups.map((group, groupIndex) => (
            <HStack key={groupIndex} spacing={10} alignment="center">
              {groupIndex > 0 ? (
                <HStack
                  modifiers={[
                    frame({ width: 10, height: 2 }),
                    background(
                      iosColors?.tertiaryLabel ?? '#AEAEB2',
                      shapes.capsule()
                    ),
                  ]}
                >
                  <Spacer />
                </HStack>
              ) : null}
              <HStack spacing={8}>
                {group.map((index) => {
                  const character = normalizedCode[index];
                  const isActive =
                    normalizedCode.length < 6 && index === normalizedCode.length;

                  return (
                    <SwiftUIText
                      key={index}
                      modifiers={[
                        font({
                          size: 26,
                          weight: 'semibold',
                          design: 'monospaced',
                        }),
                        foregroundStyle(isActive ? JOIN_TINT : 'primary'),
                        multilineTextAlignment('center'),
                        frame({ width: 43, height: 55 }),
                        background(
                          CARD_BACKGROUND,
                          shapes.roundedRectangle({ cornerRadius: 10.5 })
                        ),
                        // Equal-size ring keeps the active cell aligned with its neighbors.
                        padding({ all: 1.5 }),
                        background(
                          isActive ? JOIN_TINT : CARD_BACKGROUND,
                          shapes.roundedRectangle({ cornerRadius: 12 })
                        ),
                      ]}
                    >
                      {character ?? (isActive ? '|' : ' ')}
                    </SwiftUIText>
                  );
                })}
              </HStack>
            </HStack>
          ))}
        </HStack>
      </SwiftUIButton>
      <TextField
        ref={inputRef}
        text={nativeText}
        onTextChange={onTextChange}
        autoFocus
        modifiers={[
          textFieldStyle('plain'),
          keyboardType('numeric'),
          autocorrectionDisabled(),
          textInputAutocapitalization('characters'),
          frame({ height: 1, maxWidth: Infinity }),
          opacity(0.01),
        ]}
      />
    </VStack>
  );
}

function ConnectionChoice({
  title,
  description,
  systemImage,
  color,
  colorBackground,
  emphasized,
  emphasizedBackground,
  onPress,
}: {
  title: string;
  description: string;
  systemImage: SFSymbol;
  color: ColorValue;
  colorBackground: ColorValue;
  emphasized?: boolean;
  emphasizedBackground?: ColorValue;
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
            emphasized
              ? emphasizedBackground ?? CARD_BACKGROUND
              : CARD_BACKGROUND,
            shapes.roundedRectangle({
              cornerRadius: iosDimensions.surfaceCornerRadius,
            })
          ),
        ]}
      >
        <HStack
          alignment="center"
          modifiers={[
            frame({ width: 44, height: 44 }),
            background(colorBackground, shapes.circle()),
          ]}
        >
          <Image systemName={systemImage} size={21} color={color} />
        </HStack>
        <VStack alignment="leading" spacing={4}>
          <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
            {title}
          </SwiftUIText>
          <SwiftUIText
            modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}
          >
            {description}
          </SwiftUIText>
        </VStack>
        <Spacer />
        <Image
          systemName="chevron.forward"
          size={14}
          color={iosColors?.tertiaryLabel}
        />
      </HStack>
    </SwiftUIButton>
  );
}


type SheetActionVariant = 'primary' | 'secondary' | 'tertiary';

function SheetActionButton({
  title,
  systemImage,
  onPress,
  variant = 'primary',
  tint: buttonTint,
  isDisabled = false,
  testID,
}: {
  title: string;
  systemImage?: SFSymbol;
  onPress: () => void;
  variant?: SheetActionVariant;
  tint?: ColorValue;
  isDisabled?: boolean;
  testID?: string;
}) {
  if (variant === 'tertiary') {
    return (
      <SwiftUIButton
        testID={testID}
        onPress={onPress}
        modifiers={[
          buttonStyle('plain'),
          frame({ maxWidth: Infinity }),
          disabled(isDisabled),
        ]}
      >
        <HStack
          modifiers={[
            frame({ minHeight: 44, maxWidth: Infinity }),
            contentShape(shapes.rectangle()),
          ]}
        >
          <Spacer />
          <SwiftUIText
            modifiers={[
              font({ weight: 'medium' }),
              foregroundStyle(
                (isDisabled ? iosColors?.tertiaryLabel : iosColors?.secondaryLabel) ??
                  'secondary'
              ),
            ]}
          >
            {title}
          </SwiftUIText>
          <Spacer />
        </HStack>
      </SwiftUIButton>
    );
  }

  const styleModifiers =
    variant === 'primary'
      ? iosProminentButtonModifiers(
          buttonTint ? iosSaturatedButtonPalette(buttonTint) : undefined,
          { fullWidth: true }
        )
      : iosSecondaryButtonModifiers({ fullWidth: true });

  return (
    <SwiftUIButton
      testID={testID}
      onPress={onPress}
      modifiers={[
        ...styleModifiers,
        buttonBorderShape('capsule'),
        controlSize('large'),
        disabled(isDisabled),
        opacity(isDisabled ? 0.32 : 1),
      ]}
    >
      <HStack
        spacing={6}
        modifiers={[frame({ minHeight: 48, maxWidth: Infinity })]}
      >
        <Spacer />
        {systemImage ? <Image systemName={systemImage} size={16} /> : null}
        <SwiftUIText
          modifiers={[
            font({ weight: 'semibold' }),
            lineLimit(1),
            minimumScaleFactor(0.72),
          ]}
        >
          {title}
        </SwiftUIText>
        <Spacer />
      </HStack>
    </SwiftUIButton>
  );
}

type PairingSymbolMotion = 'searching' | 'waiting' | 'syncing';

function pairingSymbolEffect(motion?: PairingSymbolMotion) {
  if (!motion) return [];
  const options = { options: { repeat: 'continuous' as const } };
  switch (motion) {
    case 'searching':
      return [
        symbolEffect(
          { effect: 'variableColor', fillStyle: 'iterative', playbackStyle: 'nonReversing' },
          options
        ),
      ];
    case 'waiting':
      return [symbolEffect({ effect: 'breathe', style: 'pulse' }, options)];
    case 'syncing':
      return [symbolEffect({ effect: 'rotate' }, options)];
  }
}

/** Status glyph in a tinted circular badge, following the iOS 26 hero-symbol pattern. */
function PairingSymbol({
  systemName,
  tint: symbolTint,
  motion,
}: {
  systemName: SFSymbol;
  tint: string;
  motion?: PairingSymbolMotion;
}) {
  return (
    <ZStack
      modifiers={[
        frame({ width: 88, height: 88 }),
        background(hexToRgba(symbolTint, 0.14), shapes.circle()),
      ]}
    >
      <Image
        systemName={systemName}
        size={40}
        color={symbolTint}
        modifiers={pairingSymbolEffect(motion)}
      />
    </ZStack>
  );
}

function DeviceTile({
  systemName,
  name,
  tint: tileTint,
}: {
  systemName: SFSymbol;
  name: string;
  tint: string;
}) {
  return (
    <VStack
      spacing={8}
      alignment="center"
      modifiers={[frame({ maxWidth: Infinity })]}
    >
      <ZStack
        modifiers={[
          frame({ width: 72, height: 72 }),
          background(
            hexToRgba(tileTint, 0.14),
            shapes.roundedRectangle({ cornerRadius: 22 })
          ),
        ]}
      >
        <Image systemName={systemName} size={32} color={tileTint} />
      </ZStack>
      <SwiftUIText
        modifiers={[
          font({ size: 13, weight: 'medium' }),
          foregroundStyle(iosColors?.secondaryLabel ?? 'secondary'),
          multilineTextAlignment('center'),
          lineLimit(2),
        ]}
      >
        {name}
      </SwiftUIText>
    </VStack>
  );
}

/** This device and the remote device, joined by the live pairing state. */
function DevicePair({
  localName,
  remoteName,
  state,
}: {
  localName: string;
  remoteName: string;
  state: 'waiting' | 'syncing' | 'connected';
}) {
  const linked = state !== 'waiting';

  return (
    <HStack
      spacing={8}
      alignment="top"
      modifiers={[frame({ maxWidth: Infinity })]}
    >
      <DeviceTile systemName="iphone" name={localName} tint={P2P_TINT} />
      <ZStack modifiers={[frame({ width: 44, height: 72 })]}>
        <Image
          systemName={
            state === 'waiting'
              ? 'ellipsis'
              : state === 'syncing'
              ? 'arrow.triangle.2.circlepath'
              : 'checkmark.circle.fill'
          }
          size={state === 'connected' ? 26 : 22}
          color={linked ? SUCCESS_TINT : iosColors?.tertiaryLabel}
          modifiers={pairingSymbolEffect(
            state === 'waiting'
              ? 'searching'
              : state === 'syncing'
              ? 'syncing'
              : undefined
          )}
        />
      </ZStack>
      <DeviceTile
        systemName="laptopcomputer"
        name={remoteName}
        tint={linked ? SUCCESS_TINT : NEUTRAL_TINT}
      />
    </HStack>
  );
}

/** Centered status layout shared by every pairing progress and result state. */
function PairingStatus({
  graphic,
  title,
  body,
  detail,
}: {
  graphic: ReactNode;
  title: string;
  body?: string | null;
  detail?: ReactNode;
}) {
  return (
    <VStack
      spacing={0}
      alignment="center"
      modifiers={[padding({ horizontal: 28 }), frame({ maxWidth: Infinity })]}
    >
      {graphic}
      <SwiftUIText
        modifiers={[
          font({ size: 22, weight: 'bold' }),
          multilineTextAlignment('center'),
          padding({ top: 20 }),
        ]}
      >
        {title}
      </SwiftUIText>
      {body ? (
        <SwiftUIText
          modifiers={[
            foregroundStyle(iosColors?.secondaryLabel ?? 'secondary'),
            multilineTextAlignment('center'),
            padding({ top: 8 }),
          ]}
        >
          {body}
        </SwiftUIText>
      ) : null}
      {detail ? (
        <VStack modifiers={[padding({ top: 24 }), frame({ maxWidth: Infinity })]}>
          {detail}
        </VStack>
      ) : null}
    </VStack>
  );
}

function InvitationMetaChip({
  systemName,
  label,
  tint: chipTint,
}: {
  systemName: SFSymbol;
  label: string;
  tint?: ColorValue;
}) {
  const color = chipTint ?? iosColors?.secondaryLabel ?? 'secondary';
  return (
    <HStack
      spacing={5}
      modifiers={[
        padding({ horizontal: 10, vertical: 6 }),
        background(
          iosColors?.tertiarySystemFill ?? '#E5E5EA',
          shapes.capsule()
        ),
      ]}
    >
      <Image systemName={systemName} size={12} color={color} />
      <SwiftUIText
        modifiers={[
          font({ size: 13, weight: 'medium' }),
          foregroundStyle(color),
          lineLimit(1),
          minimumScaleFactor(0.8),
        ]}
      >
        {label}
      </SwiftUIText>
    </HStack>
  );
}

/** The invitation code as the hero of the waiting stage; tapping the card copies the code. */
function InvitationCodeCard({
  code,
  expiresLabel,
  copyLabel,
  copied,
  onCopy,
}: {
  code: string;
  expiresLabel: string;
  copyLabel: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const secondary = iosColors?.secondaryLabel ?? 'secondary';

  return (
    <SwiftUIButton
      onPress={onCopy}
      modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}
    >
      <VStack
        spacing={12}
        alignment="center"
        modifiers={[
          padding({ horizontal: 16, vertical: 22 }),
          frame({ maxWidth: Infinity }),
          background(
            CARD_BACKGROUND,
            shapes.roundedRectangle({ cornerRadius: iosDimensions.glassCardRadius })
          ),
          contentShape(
            shapes.roundedRectangle({ cornerRadius: iosDimensions.glassCardRadius })
          ),
        ]}
      >
        <SwiftUIText
          modifiers={[
            font({ size: 40, weight: 'bold', design: 'monospaced' }),
            lineLimit(1),
            minimumScaleFactor(0.6),
            accessibilityLabel(code.split('').join(' ')),
          ]}
        >
          {code}
        </SwiftUIText>
        <HStack spacing={16}>
          <HStack spacing={4}>
            <Image systemName="clock" size={13} color={secondary} />
            <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle(secondary)]}>
              {expiresLabel}
            </SwiftUIText>
          </HStack>
          <HStack spacing={4}>
            <Image
              systemName={copied ? 'checkmark' : 'doc.on.doc'}
              size={13}
              color={P2P_TINT}
            />
            <SwiftUIText
              modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(P2P_TINT)]}
            >
              {copyLabel}
            </SwiftUIText>
          </HStack>
        </HStack>
      </VStack>
    </SwiftUIButton>
  );
}

function JoinStepHeading({ title, body }: { title: string; body: string }) {
  return (
    <VStack
      spacing={8}
      alignment="center"
      modifiers={[padding({ horizontal: 28 }), frame({ maxWidth: Infinity })]}
    >
      <SwiftUIText
        modifiers={[
          font({ size: 22, weight: 'bold' }),
          multilineTextAlignment('center'),
        ]}
      >
        {title}
      </SwiftUIText>
      <SwiftUIText
        modifiers={[
          font({ size: 15 }),
          foregroundStyle(iosColors?.secondaryLabel ?? 'secondary'),
          multilineTextAlignment('center'),
        ]}
      >
        {body}
      </SwiftUIText>
    </VStack>
  );
}

function InvitationCodeChip({
  code,
  label,
  editLabel,
  accessibilityText,
  onPress,
}: {
  code: string;
  label: string;
  editLabel: string;
  accessibilityText: string;
  onPress: () => void;
}) {
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[buttonStyle('plain'), accessibilityLabel(accessibilityText)]}
    >
      <HStack
        spacing={6}
        modifiers={[
          padding({ horizontal: 12, vertical: 7 }),
          background(hexToRgba(SUCCESS_TINT, 0.14), shapes.capsule()),
          contentShape(shapes.capsule()),
        ]}
      >
        <Image
          systemName="checkmark"
          size={12}
          color={SUCCESS_TINT}
          modifiers={[font({ weight: 'bold' })]}
        />
        <SwiftUIText modifiers={[font({ size: 14 })]}>{label}</SwiftUIText>
        <SwiftUIText
          modifiers={[font({ size: 14, weight: 'semibold', design: 'monospaced' })]}
        >
          {code}
        </SwiftUIText>
        <SwiftUIText
          modifiers={[
            font({ size: 14 }),
            foregroundStyle(iosColors?.secondaryLabel ?? 'secondary'),
          ]}
        >
          {`· ${editLabel}`}
        </SwiftUIText>
      </HStack>
    </SwiftUIButton>
  );
}

function PassphraseField({
  inputRef,
  nativeText,
  placeholder,
  revealed,
  revealLabel,
  hideLabel,
  hasError,
  onToggleReveal,
  onTextChange,
}: {
  inputRef: React.RefObject<SecureFieldRef | null>;
  nativeText: NonNullable<React.ComponentProps<typeof SecureField>['text']>;
  placeholder: string;
  revealed: boolean;
  revealLabel: string;
  hideLabel: string;
  hasError: boolean;
  onToggleReveal: () => void;
  onTextChange: (value: string) => void;
}) {
  // Both fields bind the same native state, so revealing keeps the typed value.
  return (
    <HStack
      spacing={12}
      modifiers={[
        padding({ leading: 16, trailing: 6 }),
        frame({ minHeight: 54, maxWidth: Infinity }),
        background(
          CARD_BACKGROUND,
          shapes.roundedRectangle({ cornerRadius: 14.5 })
        ),
        padding({ all: 1.5 }),
        background(
          hasError ? ERROR_TINT : CARD_BACKGROUND,
          shapes.roundedRectangle({ cornerRadius: 16 })
        ),
      ]}
    >
      <Image
        systemName="lock.fill"
        size={16}
        color={hasError ? ERROR_TINT : NEUTRAL_TINT}
      />
      {revealed ? (
        <TextField
          text={nativeText}
          placeholder={placeholder}
          onTextChange={onTextChange}
          autoFocus
          modifiers={[
            textFieldStyle('plain'),
            autocorrectionDisabled(),
            textInputAutocapitalization('never'),
            frame({ maxWidth: Infinity }),
          ]}
        />
      ) : (
        <SecureField
          ref={inputRef}
          text={nativeText}
          placeholder={placeholder}
          onTextChange={onTextChange}
          autoFocus
          modifiers={[frame({ maxWidth: Infinity })]}
        />
      )}
      <SwiftUIButton
        onPress={onToggleReveal}
        modifiers={[
          buttonStyle('plain'),
          accessibilityLabel(revealed ? hideLabel : revealLabel),
        ]}
      >
        <Image
          systemName={revealed ? 'eye.slash' : 'eye'}
          size={17}
          color={NEUTRAL_TINT}
          modifiers={[
            frame({ width: 44, height: 44 }),
            contentShape(shapes.rectangle()),
          ]}
        />
      </SwiftUIButton>
    </HStack>
  );
}

function JoinDeviceNameRow({
  label,
  actionLabel,
  onPress,
}: {
  label: string;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity })]}
    >
      <HStack
        spacing={8}
        modifiers={[
          padding({ horizontal: 4 }),
          frame({ minHeight: 44, maxWidth: Infinity }),
          contentShape(shapes.rectangle()),
        ]}
      >
        <Image systemName="iphone" size={15} color={NEUTRAL_TINT} />
        <SwiftUIText
          modifiers={[
            font({ size: 13 }),
            foregroundStyle(iosColors?.secondaryLabel ?? 'secondary'),
            lineLimit(1),
          ]}
        >
          {label}
        </SwiftUIText>
        <Spacer />
        <SwiftUIText
          modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(JOIN_TINT)]}
        >
          {actionLabel}
        </SwiftUIText>
      </HStack>
    </SwiftUIButton>
  );
}

function InlineConnectionError({ message }: { message: string }) {
  return (
    <HStack spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
      <Image systemName="exclamationmark.circle.fill" size={15} color={ERROR_TINT} />
      <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle(ERROR_TINT)]}>
        {message}
      </SwiftUIText>
    </HStack>
  );
}

function ConnectionErrorMessage({ message }: { message: string }) {
  return (
    <Section>
      <InlineConnectionError message={message} />
    </Section>
  );
}

export function AddSyncConnectionSheet({
  visible,
  initialMode = 'choose',
  embeddedInHost = false,
  persistentPresentation = false,
  previewScenario,
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
  const invitationCodeState = useNativeState('');
  const deviceNameState = useNativeState(defaultDeviceName);
  const passphraseRef = useRef<SecureFieldRef>(null);
  const passphraseState = useNativeState('');
  const [passphraseRevealed, setPassphraseRevealed] = useState(false);
  const [editingDeviceName, setEditingDeviceName] = useState(false);
  const autoAdvanceRef = useRef(false);
  const liveFlow = useAddSyncConnectionFlow({
    visible: visible && previewScenario == null,
    initialMode,
    defaultDeviceName,
    onClose,
    onConnected,
    resetNativeFields: (nextDeviceName) => {
      deviceNameState.value = nextDeviceName;
      invitationCodeState.value = '';
      passphraseState.value = '';
      void passphraseRef.current?.clear();
      void invitationCodeRef.current?.clear();
    },
    clearNativePassphrase: () => {
      passphraseState.value = '';
      void passphraseRef.current?.clear();
    },
  });
  const previewFlow = useAddSyncConnectionPreviewFlow(
    previewScenario ?? 'joinPending',
    onClose
  );
  const { state, actions } = previewScenario ? previewFlow : liveFlow;
  const {
    mode,
    deviceName,
    invitationCode,
    invitation,
    pending,
    joinSubmitted,
    restoredJoin,
    joinTakingLonger,
    cancellingJoin,
    error,
    copied,
    canSubmitDetails,
    codeComplete,
    invitationExpired,
    invitationTimeRemaining,
    remoteDeviceName,
    peerUpgradeRequired,
    deviceUpdate,
    removalAcknowledgementPending,
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
    editJoinDetails,
    cancelJoin,
    renewInvitation,
    copyInvitation,
    shareInvitation,
    completeConnection,
  } = actions;
  const showsJoinStatus =
    mode === 'joinDetails' && (joinSubmitted || restoredJoin || pending);

  // Only a fresh completion advances; returning to edit a full code must not bounce forward.
  const trackCodeCompletion = (normalized: string) => {
    autoAdvanceRef.current =
      !codeComplete && normalizeInvitationCodeInput(normalized).length === 6;
  };

  const handleInvitationCodeChange = (value: string) => {
    const normalized = invitationCodeInputValue(value);
    if (normalized !== value) invitationCodeState.value = normalized;
    trackCodeCompletion(normalized);
    updateInvitationCode(normalized);
  };

  const pasteInvitation = async () => {
    const normalized = invitationCodeInputValue(
      await ClipboardProxy.getStringAsync()
    );
    invitationCodeState.value = normalized;
    trackCodeCompletion(normalized);
    updateInvitationCode(normalized);
    if (normalized.length < 6) void invitationCodeRef.current?.focus();
  };

  useEffect(() => {
    if (mode !== 'joinCode' || !autoAdvanceRef.current) return;
    if (!codeComplete || error) return;
    autoAdvanceRef.current = false;
    continueFromCode();
  }, [mode, codeComplete, error, continueFromCode]);

  useEffect(() => {
    if (mode === 'joinDetails') return;
    setPassphraseRevealed(false);
    setEditingDeviceName(false);
  }, [mode]);

  useEffect(() => {
    // Every stage fits the medium detent; the user can still drag to large.
    setSheetDetent('medium');
  }, [mode]);
  const title =
    mode === 'create'
      ? t('space.create.title')
      : mode === 'joinCode'
      ? t('space.flow.joinCodeSheetTitle')
      : mode === 'joinDetails'
      ? t('space.flow.joinCodeSheetTitle')
      : mode === 'invitation'
      ? t('space.flow.waitingTitle')
      : mode === 'joinUpdating' || mode === 'joinReady'
      ? t('space.flow.joinCodeSheetTitle')
      : mode === 'success'
      ? t('space.flow.successTitle')
      : t('connection.addSheetTitle');
  const canGoBack = mode === 'joinDetails' && !showsJoinStatus;
  const Sheet = persistentPresentation ? PersistentBottomSheet : BottomSheet;

  return (
    <ConnectionSheetHost embedded={embeddedInHost}>
      <Sheet
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
            interactiveDismissDisabled(pending),
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
                isDisabled={pending}
              />,
            ]}
            rightSlots={
              canGoBack
                ? [
                    <HeaderCircleButton
                      key="close"
                      systemName="xmark"
                      onPress={close}
                      isDisabled={pending}
                    />,
                  ]
                : undefined
            }
          >
            {mode === 'choose' ? (
              <IosSheetScaffold>
                <List
                  modifiers={[
                    listStyle('plain'),
                    scrollContentBackground('hidden'),
                    frame({ maxWidth: Infinity, maxHeight: Infinity }),
                  ]}
                >
                  <Section title={t('space.title')}>
                    <ConnectionChoice
                      title={t('space.create.title')}
                      description={t('space.create.description')}
                      systemImage="plus"
                      color={P2P_TINT}
                      colorBackground={hexToRgba(P2P_TINT, 0.18)}
                      emphasized
                      emphasizedBackground={hexToRgba(P2P_TINT, 0.1)}
                      onPress={() => selectMode('create')}
                    />
                    <ConnectionChoice
                      title={t('space.join.title')}
                      description={t('space.join.description')}
                      systemImage="link"
                      color={JOIN_TINT}
                      colorBackground={
                        iosColors?.tertiarySystemFill ?? CARD_BACKGROUND
                      }
                      onPress={() => selectMode('joinCode')}
                    />
                  </Section>
                </List>
              </IosSheetScaffold>
            ) : null}


            {mode === 'create' ? (
              <IosSheetScaffold
                footer={
                  <SheetActionButton
                    title={t('space.create.action')}
                    systemImage="plus.circle.fill"
                    tint={P2P_TINT}
                    onPress={submitCreate}
                    isDisabled={!canSubmitDetails || pending}
                  />
                }
              >
                <IosSheetForm modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
                  <Section
                    footer={
                      <SwiftUIText>{t('space.flow.createBody')}</SwiftUIText>
                    }
                  >
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
                      autoFocus
                      modifiers={[frame({ minHeight: 30 })]}
                    />
                  </Section>
                  {error ? <ConnectionErrorMessage message={error} /> : null}
                </IosSheetForm>
              </IosSheetScaffold>
            ) : null}

            {mode === 'joinCode' ? (
              <IosSheetScaffold
                footer={
                  <SheetActionButton
                    title={t('space.flow.continue')}
                    onPress={continueFromCode}
                    isDisabled={!codeComplete}
                  />
                }
              >
                <VStack
                  spacing={0}
                  alignment="center"
                  modifiers={[frame({ maxWidth: Infinity })]}
                >
                  <JoinStepHeading
                    title={t('space.flow.joinCodeTitle')}
                    body={t('space.flow.joinCodeBody')}
                  />
                  <VStack
                    spacing={16}
                    alignment="center"
                    modifiers={[
                      padding({ horizontal: 20, top: 26 }),
                      frame({ maxWidth: Infinity }),
                    ]}
                  >
                    <InvitationCodeField
                      code={invitationCode}
                      inputRef={invitationCodeRef}
                      label={t('space.flow.joinCodeTitle')}
                      nativeText={invitationCodeState}
                      onTextChange={handleInvitationCodeChange}
                    />
                    {error ? <InlineConnectionError message={error} /> : null}
                    <SwiftUIButton
                      systemImage="doc.on.clipboard"
                      label={t('space.flow.pasteInvitation')}
                      onPress={() => void pasteInvitation()}
                      modifiers={[
                        buttonStyle('bordered'),
                        buttonBorderShape('capsule'),
                        controlSize('regular'),
                      ]}
                    />
                  </VStack>
                </VStack>
              </IosSheetScaffold>
            ) : null}

            {mode === 'joinDetails' ? (
              <IosSheetScaffold
                contentAlignment={showsJoinStatus ? 'center' : 'top'}
                footer={
                  !showsJoinStatus ? (
                    <SheetActionButton
                      title={t('space.join.action')}
                      systemImage="link.circle.fill"
                      onPress={submitJoin}
                      isDisabled={!canSubmitDetails}
                    />
                  ) : pending ? (
                    <SheetActionButton
                      variant="tertiary"
                      title={t('action.cancel', { ns: 'common' })}
                      onPress={cancelJoin}
                      isDisabled={cancellingJoin}
                    />
                  ) : error ? (
                    <>
                      <SheetActionButton
                        title={t('space.join.editDetails')}
                        onPress={editJoinDetails}
                      />
                      <SheetActionButton
                        variant="tertiary"
                        title={t('action.close', { ns: 'common' })}
                        onPress={close}
                      />
                    </>
                  ) : null
                }
              >
                {showsJoinStatus ? (
                  <PairingStatus
                    graphic={
                      !pending && error ? (
                        <PairingSymbol
                          systemName="exclamationmark.triangle.fill"
                          tint={ERROR_TINT}
                        />
                      ) : cancellingJoin ? (
                        <PairingSymbol
                          systemName="xmark"
                          tint={NEUTRAL_TINT}
                          motion="waiting"
                        />
                      ) : (
                        <PairingSymbol
                          systemName="antenna.radiowaves.left.and.right"
                          tint={P2P_TINT}
                          motion="searching"
                        />
                      )
                    }
                    title={t(
                      !pending && error
                        ? 'space.join.failedTitle'
                        : cancellingJoin
                        ? 'space.join.cancelling'
                        : 'space.join.processing'
                    )}
                    body={
                      !pending && error
                        ? error
                        : cancellingJoin
                        ? null
                        : t(
                            joinTakingLonger
                              ? 'space.join.takingLonger'
                              : 'space.join.pending'
                          )
                    }
                    detail={
                      pending && !cancellingJoin ? (
                        <InvitationMetaChip
                          systemName="number"
                          label={formatInvitationCode(
                            normalizeInvitationCodeInput(invitationCode)
                          )}
                        />
                      ) : null
                    }
                  />
                ) : (
                  <ScrollView
                    showsIndicators={false}
                    modifiers={[frame({ maxWidth: Infinity })]}
                  >
                    <VStack
                      spacing={0}
                      alignment="center"
                      modifiers={[frame({ maxWidth: Infinity })]}
                    >
                      <JoinStepHeading
                        title={t('space.flow.joinPassphraseTitle')}
                        body={t('space.flow.joinDetailsBody')}
                      />
                      <VStack
                        spacing={10}
                        alignment="leading"
                        modifiers={[
                          padding({ horizontal: 20, top: 16 }),
                          frame({ maxWidth: Infinity }),
                        ]}
                      >
                        <HStack modifiers={[frame({ maxWidth: Infinity })]}>
                          <Spacer />
                          <InvitationCodeChip
                            code={formatInvitationCode(
                              normalizeInvitationCodeInput(invitationCode)
                            )}
                            label={t('space.field.invitationCode')}
                            editLabel={t('space.flow.editInvitationCode')}
                            accessibilityText={t(
                              'space.flow.editInvitationCodeAccessibility',
                              {
                                code: formatInvitationCode(
                                  normalizeInvitationCodeInput(invitationCode)
                                ),
                              }
                            )}
                            onPress={back}
                          />
                          <Spacer />
                        </HStack>
                        <PassphraseField
                          inputRef={passphraseRef}
                          nativeText={passphraseState}
                          placeholder={t('space.field.passphrase')}
                          revealed={passphraseRevealed}
                          revealLabel={t('space.flow.showPassphrase')}
                          hideLabel={t('space.flow.hidePassphrase')}
                          hasError={Boolean(error)}
                          onToggleReveal={() =>
                            setPassphraseRevealed((revealed) => !revealed)
                          }
                          onTextChange={setPassphrase}
                        />
                        {error ? <InlineConnectionError message={error} /> : null}
                        {editingDeviceName ? (
                          <TextField
                            text={deviceNameState}
                            placeholder={t('space.field.deviceName')}
                            onTextChange={setDeviceName}
                            autoFocus
                            modifiers={[
                              textFieldStyle('plain'),
                              textInputAutocapitalization('words'),
                              padding({ horizontal: 16 }),
                              frame({ minHeight: 50, maxWidth: Infinity }),
                              background(
                                CARD_BACKGROUND,
                                shapes.roundedRectangle({ cornerRadius: 16 })
                              ),
                            ]}
                          />
                        ) : (
                          <JoinDeviceNameRow
                            label={t('space.flow.joinAsDevice', {
                              name: deviceName.trim() || defaultDeviceName,
                            })}
                            actionLabel={t('space.flow.renameDevice')}
                            onPress={() => setEditingDeviceName(true)}
                          />
                        )}
                      </VStack>
                    </VStack>
                  </ScrollView>
                )}
              </IosSheetScaffold>
            ) : null}

            {mode === 'invitation' && invitation ? (
              <IosSheetScaffold
                contentAlignment="center"
                footer={
                  <>
                    {invitationExpired ? (
                      <SheetActionButton
                        title={t('space.flow.renewInvitation')}
                        systemImage="arrow.clockwise"
                        tint={P2P_TINT}
                        onPress={() => void renewInvitation()}
                      />
                    ) : (
                      <SheetActionButton
                        title={t('space.flow.shareInvitation')}
                        systemImage="square.and.arrow.up"
                        tint={P2P_TINT}
                        onPress={() => void shareInvitation()}
                      />
                    )}
                    <SheetActionButton
                      testID="space-finish-later"
                      variant="tertiary"
                      title={t('space.flow.finishLater')}
                      onPress={() => void completeConnection()}
                    />
                  </>
                }
              >
                <ScrollView
                  showsIndicators={false}
                  modifiers={[frame({ maxWidth: Infinity })]}
                >
                  {invitationExpired ? (
                    <VStack
                      alignment="center"
                      modifiers={[
                        padding({ horizontal: 20, vertical: 12 }),
                        frame({ maxWidth: Infinity }),
                      ]}
                    >
                      <PairingStatus
                        graphic={
                          <PairingSymbol
                            systemName="clock.badge.exclamationmark"
                            tint={ATTENTION_TINT}
                          />
                        }
                        title={t('space.flow.expired')}
                        body={t('space.flow.expiredBody')}
                      />
                    </VStack>
                  ) : (
                    <VStack
                      spacing={14}
                      alignment="leading"
                      modifiers={[
                        padding({ horizontal: 20, vertical: 12 }),
                        frame({ maxWidth: Infinity }),
                      ]}
                    >
                      {/* One status line replaces the device illustration, status title, and body. */}
                      <HStack spacing={8}>
                        <Image
                          systemName="antenna.radiowaves.left.and.right"
                          size={17}
                          color={P2P_TINT}
                          modifiers={pairingSymbolEffect('searching')}
                        />
                        <SwiftUIText
                          modifiers={[font({ weight: 'semibold' }), foregroundStyle(P2P_TINT)]}
                        >
                          {t('space.flow.waitingForDevice')}
                        </SwiftUIText>
                      </HStack>
                      <InvitationCodeCard
                        code={invitation.invitationCode}
                        expiresLabel={t('space.flow.expiresIn', {
                          time: invitationTimeRemaining,
                        })}
                        copyLabel={t('space.flow.copyInvitation')}
                        copied={copied}
                        onCopy={() => void copyInvitation()}
                      />
                      <SwiftUIText
                        modifiers={[
                          font({ size: 13 }),
                          foregroundStyle(iosColors?.secondaryLabel ?? 'secondary'),
                        ]}
                      >
                        {t(
                          invitation.availability === 'sameLocalNetwork'
                            ? 'space.invitation.sameLocalNetwork'
                            : 'space.invitation.crossNetwork'
                        )}
                      </SwiftUIText>
                    </VStack>
                  )}
                  {error ? <InlineConnectionError message={error} /> : null}
                </ScrollView>
              </IosSheetScaffold>
            ) : null}

            {mode === 'success' ? (
              <IosSheetScaffold
                contentAlignment="center"
                footer={
                  <SheetActionButton
                    title={t('action.done', { ns: 'common' })}
                    tint={SUCCESS_TINT}
                    onPress={() => void completeConnection()}
                  />
                }
              >
                <PairingStatus
                  graphic={
                    <DevicePair
                      localName={deviceName}
                      remoteName={remoteDeviceName ?? t('space.flow.otherDevice')}
                      state="connected"
                    />
                  }
                  title={t('space.flow.successTitle')}
                  body={t(
                    peerUpgradeRequired
                      ? 'space.flow.peerUpgradeRequired'
                      : 'space.flow.successBody'
                  )}
                />
              </IosSheetScaffold>
            ) : null}

            {mode === 'joinUpdating' ? (
              deviceUpdate.phase === 'needsAttention' ? (
                <IosSheetScaffold
                  footer={
                    <>
                      <SheetActionButton
                        title={t('space.flow.deviceUpdate.attention.reviewAction')}
                        onPress={close}
                      />
                      <SheetActionButton
                        variant="tertiary"
                        title={t('space.flow.deviceUpdate.attention.cancelAction')}
                        onPress={close}
                      />
                    </>
                  }
                  contentAlignment="center"
                >
                  <PairingStatus
                    graphic={
                      <PairingSymbol
                        systemName="exclamationmark.triangle.fill"
                        tint={ATTENTION_TINT}
                      />
                    }
                    title={t('space.flow.deviceUpdate.attention.blockedTitle')}
                    body={t(
                      `space.flow.deviceUpdate.reason.${
                        deviceUpdate.reason ?? 'deviceStateRejected'
                      }`
                    )}
                  />
                </IosSheetScaffold>
              ) : (
                <IosSheetScaffold
                  contentAlignment="center"
                  footer={
                    <SheetActionButton
                      variant="tertiary"
                      title={t('space.flow.deviceUpdate.continueInBackground')}
                      onPress={close}
                    />
                  }
                >
                  <PairingStatus
                    graphic={
                      <DevicePair
                        localName={deviceName}
                        remoteName={t('space.flow.otherDevice')}
                        state="syncing"
                      />
                    }
                    title={t('space.flow.deviceUpdate.updatingTitle')}
                    body={t(
                      deviceUpdate.phase === 'retryableFailure'
                        ? 'space.flow.deviceUpdate.retryingBody'
                        : 'space.flow.deviceUpdate.updatingBody'
                    )}
                  />
                </IosSheetScaffold>
              )
            ) : null}

            {mode === 'joinReady' ? (
              <IosSheetScaffold
                contentAlignment="center"
                footer={
                  <SheetActionButton
                    title={t('action.done', { ns: 'common' })}
                    tint={SUCCESS_TINT}
                    onPress={() => void completeConnection()}
                  />
                }
              >
                <PairingStatus
                  graphic={
                    <PairingSymbol
                      systemName="checkmark.circle.fill"
                      tint={SUCCESS_TINT}
                    />
                  }
                  title={t('space.flow.deviceUpdate.completedTitle')}
                  body={
                    removalAcknowledgementPending
                      ? `${t('space.flow.deviceUpdate.completedBody')} ${t(
                          'space.flow.deviceUpdate.removalNotificationPending'
                        )}`
                      : t('space.flow.deviceUpdate.completedBody')
                  }
                />
              </IosSheetScaffold>
            ) : null}
          </IosSheetPage>
        </Group>
      </Sheet>
    </ConnectionSheetHost>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 0, height: 0 },
});
