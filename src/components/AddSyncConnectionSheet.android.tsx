import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Device from 'expo-device';
import {
  AssistChip,
  BasicTextField,
  Box,
  Button,
  Column,
  Host,
  Icon,
  IconButton,
  ContainedLoadingIndicator,
  LinearWavyProgressIndicator,
  LoadingIndicator,
  ModalBottomSheet,
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
  alpha,
  background,
  clickable,
  clip,
  Shapes,
  fillMaxWidth,
  height as heightModifier,
  paddingAll,
  padding,
  size,
  verticalScroll,
  weight,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/useTheme';
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

const ICONS = {
  space: require('../assets/icons/groups.xml'),
  device: require('../assets/icons/account_circle.xml'),
  ready: require('../assets/icons/check_circle.xml'),
  copy: require('../assets/icons/content_copy.xml'),
  share: require('../assets/icons/share.xml'),
  clock: require('../assets/icons/clock.xml'),
  wifi: require('../assets/icons/wifi.xml'),
  public: require('../assets/icons/public.xml'),
  close: require('../assets/icons/close.xml'),
  chevron: require('../assets/icons/chevron_right.xml'),
  retry: require('../assets/icons/restart_alt.xml'),
  paste: require('../assets/icons/content_paste.xml'),
  phone: require('../assets/icons/smartphone.xml'),
  lock: require('../assets/icons/lock.xml'),
  check: require('../assets/icons/check.xml'),
  show: require('../assets/icons/visibility.xml'),
  hide: require('../assets/icons/visibility_off.xml'),
};

const TITLE_STYLE = { typography: 'titleLarge' } as const;
const OPTION_TITLE_STYLE = { typography: 'titleMedium' } as const;
const STATUS_TITLE_STYLE = {
  typography: 'headlineSmall',
  fontWeight: '600',
  textAlign: 'center',
} as const;
const INVITATION_STYLE = {
  typography: 'displaySmall',
  fontFamily: 'monospace',
  fontWeight: '700',
  letterSpacing: 0,
  textAlign: 'center',
} as const;
const CODE_CELL_STYLE = {
  typography: 'headlineMedium',
  fontFamily: 'monospace',
  fontWeight: '600',
  textAlign: 'center',
} as const;
const CODE_CELL_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 12, topEnd: 12, bottomStart: 12, bottomEnd: 12 },
});
const CODE_CHIP_STYLE = { fontFamily: 'monospace', fontWeight: '600' } as const;
const WAITING_STYLE = { textAlign: 'center' } as const;
const CONNECTED_DEVICE_STYLE = {
  typography: 'headlineSmall',
  textAlign: 'center',
} as const;

const PILL_SHAPE = Shape.Pill({});
// M3 Expressive connected list: large outer corners, tight inner corners between grouped rows.
const CHOICE_ROW_OUTER_RADIUS = 24;
const CHOICE_ROW_INNER_RADIUS = 6;
const CHOICE_ROW_SHAPES = {
  first: Shape.RoundedCorner({
    cornerRadii: {
      topStart: CHOICE_ROW_OUTER_RADIUS,
      topEnd: CHOICE_ROW_OUTER_RADIUS,
      bottomStart: CHOICE_ROW_INNER_RADIUS,
      bottomEnd: CHOICE_ROW_INNER_RADIUS,
    },
  }),
  last: Shape.RoundedCorner({
    cornerRadii: {
      topStart: CHOICE_ROW_INNER_RADIUS,
      topEnd: CHOICE_ROW_INNER_RADIUS,
      bottomStart: CHOICE_ROW_OUTER_RADIUS,
      bottomEnd: CHOICE_ROW_OUTER_RADIUS,
    },
  }),
} as const;
// Expressive "cookie" shape for hero status glyphs, contrasting with circular device badges.
const HERO_BADGE_SHAPE = Shapes.Material.Cookie9Sided;
const HERO_BADGE_SIZE = 88;
const INVITATION_CARD_SHAPE = Shape.RoundedCorner({ cornerRadii: { topStart: 24, topEnd: 24, bottomStart: 24, bottomEnd: 24 } });

/** Tonal circular container for a leading or status icon, the M3 Expressive "large icon" pattern. */
function IconBadge({
  icon,
  size: badgeSize = 56,
  iconSize = 26,
  tint,
  tintContainer,
  hero = false,
}: {
  icon: number;
  size?: number;
  iconSize?: number;
  tint: string;
  tintContainer: string;
  hero?: boolean;
}) {
  return (
    <Box
      contentAlignment="center"
      modifiers={[
        size(badgeSize, badgeSize),
        clip(hero ? HERO_BADGE_SHAPE : Shapes.Circle),
        background(tintContainer),
      ]}
    >
      <Icon source={icon} size={iconSize} tint={tint} />
    </Box>
  );
}

/** A full-width, full-row tappable option for the create/join choice step. */
function ConnectionChoiceRow({
  title,
  description,
  icon,
  tint,
  tintContainer,
  position,
  onClick,
}: {
  position: keyof typeof CHOICE_ROW_SHAPES;
  title: string;
  description: string;
  icon: number;
  tint: string;
  tintContainer: string;
  onClick: () => void;
}) {
  const colors = useMaterialColors();

  return (
    <Surface
      color={colors.surfaceContainer}
      shape={CHOICE_ROW_SHAPES[position]}
      modifiers={[fillMaxWidth(), clickable(onClick)]}
    >
      <Row verticalAlignment="center" modifiers={[paddingAll(16), fillMaxWidth()]}>
        <IconBadge icon={icon} tint={tint} tintContainer={tintContainer} />
        <Spacer modifiers={[widthModifier(14)]} />
        <Column modifiers={[weight(1)]}>
          <ComposeText style={OPTION_TITLE_STYLE}>{title}</ComposeText>
          <ComposeText color={colors.onSurfaceVariant}>{description}</ComposeText>
        </Column>
        <Icon source={ICONS.chevron} size={22} tint={colors.onSurfaceVariant} />
      </Row>
    </Surface>
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
  const colors = useMaterialColors();

  return (
    <Column horizontalAlignment="center" modifiers={[fillMaxWidth()]}>
      {graphic}
      <Spacer modifiers={[heightModifier(20)]} />
      <ComposeText style={STATUS_TITLE_STYLE}>{title}</ComposeText>
      {body ? (
        <>
          <Spacer modifiers={[heightModifier(8)]} />
          <ComposeText color={colors.onSurfaceVariant} style={WAITING_STYLE}>
            {body}
          </ComposeText>
        </>
      ) : null}
      {detail ? (
        <>
          <Spacer modifiers={[heightModifier(20)]} />
          {detail}
        </>
      ) : null}
    </Column>
  );
}

/** This device and the remote device, joined by an icon reflecting the live pairing state. */
function DevicePair({
  localName,
  remoteName,
  state,
}: {
  localName: string;
  remoteName: string;
  state: 'waiting' | 'syncing' | 'connected';
}) {
  const colors = useMaterialColors();
  const linked = state !== 'waiting';
  const connectorTint = linked ? colors.primary : colors.onSurfaceVariant;
  const connectorContainer = linked ? colors.primaryContainer : colors.surfaceContainerHighest;

  return (
    <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
      <Column horizontalAlignment="center" modifiers={[weight(1)]}>
        <IconBadge icon={ICONS.device} tint={colors.onSurfaceVariant} tintContainer={colors.surfaceContainerHighest} />
        <Spacer modifiers={[heightModifier(6)]} />
        <ComposeText color={colors.onSurfaceVariant} maxLines={1}>
          {localName}
        </ComposeText>
      </Column>
      {state === 'connected' ? (
        <IconBadge
          icon={ICONS.ready}
          size={40}
          iconSize={20}
          tint={connectorTint}
          tintContainer={connectorContainer}
        />
      ) : (
        // Indeterminate wavy track: the M3 Expressive signal that the link is live but unfinished.
        <LinearWavyProgressIndicator
          color={connectorTint}
          trackColor={colors.surfaceContainerHighest}
          modifiers={[widthModifier(56)]}
        />
      )}
      <Column horizontalAlignment="center" modifiers={[weight(1)]}>
        <IconBadge icon={ICONS.device} tint={connectorTint} tintContainer={connectorContainer} />
        <Spacer modifiers={[heightModifier(6)]} />
        <ComposeText color={colors.onSurfaceVariant} maxLines={1}>
          {remoteName}
        </ComposeText>
      </Column>
    </Row>
  );
}

/** Assist chip used for supplementary metadata such as the invitation code being joined. */
function MetaChip({ icon, label }: { icon: number; label: string }) {
  const colors = useMaterialColors();
  return (
    <AssistChip>
      <AssistChip.LeadingIcon>
        <Icon source={icon} size={16} tint={colors.onSurfaceVariant} />
      </AssistChip.LeadingIcon>
      <AssistChip.Label>
        <ComposeText>{label}</ComposeText>
      </AssistChip.Label>
    </AssistChip>
  );
}

/** The invitation code as the hero of the waiting stage; the whole card copies the code. */
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
  const colors = useMaterialColors();

  return (
    <Surface
      color={colors.surfaceContainerHigh}
      shape={INVITATION_CARD_SHAPE}
      modifiers={[fillMaxWidth(), clickable(onCopy)]}
    >
      <Column horizontalAlignment="center" modifiers={[paddingAll(20), fillMaxWidth()]}>
        <ComposeText style={INVITATION_STYLE}>{code}</ComposeText>
        <Spacer modifiers={[heightModifier(10)]} />
        <Row verticalAlignment="center">
          <Icon source={ICONS.clock} size={16} tint={colors.onSurfaceVariant} />
          <Spacer modifiers={[widthModifier(4)]} />
          <ComposeText color={colors.onSurfaceVariant}>{expiresLabel}</ComposeText>
          <Spacer modifiers={[widthModifier(16)]} />
          <Icon
            source={copied ? ICONS.ready : ICONS.copy}
            size={16}
            tint={colors.primary}
          />
          <Spacer modifiers={[widthModifier(4)]} />
          <ComposeText color={colors.primary}>{copyLabel}</ComposeText>
        </Row>
      </Column>
    </Surface>
  );
}

/**
 * Six-cell invitation code input. The bare field owns focus and the keyboard; the cells are its
 * decoration, so tapping anywhere on them focuses the field.
 */
function InvitationCodeCells({
  code,
  nativeText,
  inputRef,
  onValueChange,
}: {
  code: string;
  nativeText: ReturnType<typeof useNativeState<string>>;
  inputRef: React.RefObject<TextFieldRef | null>;
  onValueChange: (value: string) => void;
}) {
  const colors = useMaterialColors();
  const normalizedCode = normalizeInvitationCodeInput(code);
  const cells = Array.from({ length: 6 }, (_, index) => index);
  const groups = [cells.slice(0, 3), cells.slice(3, 6)];

  return (
    <BasicTextField
      ref={inputRef}
      value={nativeText}
      onValueChange={onValueChange}
      autoFocus
      singleLine
      cursorColor="transparent"
      keyboardOptions={{
        autoCorrectEnabled: false,
        keyboardType: 'number',
        imeAction: 'next',
      }}
      modifiers={[fillMaxWidth()]}
    >
      <BasicTextField.DecorationBox>
        <Box contentAlignment="center" modifiers={[fillMaxWidth()]}>
          <Row verticalAlignment="center">
            {groups.map((group, groupIndex) => (
              <Row key={groupIndex} verticalAlignment="center">
                {groupIndex > 0 ? (
                  <Box
                    modifiers={[
                      padding(10, 0, 10, 0),
                      size(10, 2),
                      background(colors.outline),
                    ]}
                  />
                ) : null}
                {group.map((index) => {
                  const isActive =
                    normalizedCode.length < 6 && index === normalizedCode.length;
                  return (
                    <Surface
                      key={index}
                      color={colors.surfaceContainerHighest}
                      shape={CODE_CELL_SHAPE}
                      border={{
                        width: 2,
                        color: isActive ? colors.primary : 'transparent',
                      }}
                      modifiers={[padding(index % 3 === 0 ? 0 : 8, 0, 0, 0)]}
                    >
                      <Box contentAlignment="center" modifiers={[size(44, 56)]}>
                        <ComposeText
                          style={CODE_CELL_STYLE}
                          color={isActive ? colors.primary : colors.onSurface}
                        >
                          {normalizedCode[index] ?? (isActive ? '|' : ' ')}
                        </ComposeText>
                      </Box>
                    </Surface>
                  );
                })}
              </Row>
            ))}
          </Row>
          {/* The real input stays in the tree for focus and IME, but draws nothing. */}
          <Box modifiers={[size(1, 1), alpha(0)]}>
            <BasicTextField.InnerTextField />
          </Box>
        </Box>
      </BasicTextField.DecorationBox>
    </BasicTextField>
  );
}

/** Confirms the entered invitation code on the password step; tapping it returns to edit. */
function InvitationCodeChip({
  code,
  label,
  editLabel,
  onClick,
}: {
  code: string;
  label: string;
  editLabel: string;
  onClick: () => void;
}) {
  const colors = useMaterialColors();
  return (
    <AssistChip onClick={onClick}>
      <AssistChip.LeadingIcon>
        <Icon source={ICONS.check} size={18} tint={colors.primary} />
      </AssistChip.LeadingIcon>
      <AssistChip.Label>
        <Row verticalAlignment="center">
          <ComposeText>{`${label} `}</ComposeText>
          <ComposeText style={CODE_CHIP_STYLE}>{code}</ComposeText>
          <ComposeText color={colors.onSurfaceVariant}>{` · ${editLabel}`}</ComposeText>
        </Row>
      </AssistChip.Label>
    </AssistChip>
  );
}

/** Collapsed device name; the whole row opens the name editor. */
function JoinDeviceNameRow({
  label,
  actionLabel,
  onClick,
}: {
  label: string;
  actionLabel: string;
  onClick: () => void;
}) {
  const colors = useMaterialColors();
  return (
    <Row
      verticalAlignment="center"
      modifiers={[
        fillMaxWidth(),
        clip(Shapes.RoundedCorner(16)),
        clickable(onClick),
        padding(12, 12, 12, 12),
      ]}
    >
      <Icon source={ICONS.phone} size={18} tint={colors.onSurfaceVariant} />
      <Spacer modifiers={[widthModifier(10)]} />
      <ComposeText color={colors.onSurfaceVariant} modifiers={[weight(1)]}>
        {label}
      </ComposeText>
      <ComposeText color={colors.primary}>{actionLabel}</ComposeText>
    </Row>
  );
}

function InlineConnectionError({ message }: { message: string }) {
  const colors = useMaterialColors();

  return (
    <Surface color={colors.errorContainer} shape={PILL_SHAPE} modifiers={[fillMaxWidth()]}>
      <Row verticalAlignment="center" modifiers={[padding(14, 10, 14, 10), fillMaxWidth()]}>
        <Icon source={ICONS.close} size={18} tint={colors.onErrorContainer} />
        <Spacer modifiers={[widthModifier(8)]} />
        <ComposeText color={colors.onErrorContainer} modifiers={[weight(1)]}>
          {message}
        </ComposeText>
      </Row>
    </Surface>
  );
}

function AddSyncConnectionSheetContent({
  visible,
  initialMode = 'choose',
  previewScenario,
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
  const [passphraseRevealed, setPassphraseRevealed] = useState(false);
  const [editingDeviceName, setEditingDeviceName] = useState(false);
  const autoAdvanceRef = useRef(false);
  const invitationCodeState = useNativeState('');
  const liveFlow = useAddSyncConnectionFlow({
    visible: visible && previewScenario == null,
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
  const title =
    mode === 'create'
      ? t('space.create.title')
      : mode === 'joinCode'
      ? t('space.flow.joinCodeTitle')
      : mode === 'joinDetails'
      ? t(
          showsJoinStatus
            ? 'space.flow.joinCodeSheetTitle'
            : 'space.flow.joinPassphraseTitle'
        )
      : mode === 'invitation'
      ? t('space.flow.waitingTitle')
      : mode === 'joinUpdating' || mode === 'joinReady'
      ? t('space.flow.joinCodeSheetTitle')
      : mode === 'success'
      ? t('space.flow.successTitle')
      : t('connection.addSheetTitle');

  // Only a fresh completion advances; returning to edit a full code must not bounce forward.
  const handleInvitationCodeChange = (value: string) => {
    const normalized = invitationCodeInputValue(value);
    if (normalized !== value) invitationCodeState.value = normalized;
    autoAdvanceRef.current =
      !codeComplete && normalizeInvitationCodeInput(normalized).length === 6;
    updateInvitationCode(normalized);
  };

  const pasteInvitation = async () => {
    const normalized = invitationCodeInputValue(
      await ClipboardProxy.getStringAsync()
    );
    invitationCodeState.value = normalized;
    handleInvitationCodeChange(normalized);
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

  const sheetRef = useRef<ModalBottomSheetRef>(null);

  const stage = showsJoinStatus ? 'joinStatus' : mode;
  const previousStage = useRef(stage);

  useEffect(() => {
    const changed = previousStage.current !== stage;
    previousStage.current = stage;
    // Content height changes between stages, so re-fit the wrap-content sheet to the new stage.
    // Skip the first mount: the native sheet view is not registered yet and the command rejects.
    if (!visible || !changed) return;
    sheetRef.current?.expand().catch(() => {
      // The sheet was dismissed while the stage changed; there is nothing left to resize.
    });
  }, [stage, visible]);

  if (!visible) return null;

  return (
    <ModalBottomSheet ref={sheetRef} onDismissRequest={close}>
      <Column
        modifiers={[
          paddingAll(24),
          fillMaxWidth(),
          // Every stage wraps its content so actions sit right under it; scroll only when a
          // stage is taller than the screen allows.
          verticalScroll(),
        ]}
      >
        <ComposeText style={TITLE_STYLE}>{title}</ComposeText>
        <Spacer modifiers={[heightModifier(8)]} />

        {mode === 'choose' ? (
          <Column modifiers={[fillMaxWidth()]}>
            <ComposeText color={colors.onSurfaceVariant}>
              {t('connection.p2pDescription')}
            </ComposeText>
            <Spacer modifiers={[heightModifier(16)]} />
            <ConnectionChoiceRow
              title={t('space.create.title')}
              description={t('space.create.description')}
              icon={ICONS.space}
              tint={colors.onPrimaryContainer}
              tintContainer={colors.primaryContainer}
              position="first"
              onClick={() => selectMode('create')}
            />
            <Spacer modifiers={[heightModifier(2)]} />
            <ConnectionChoiceRow
              title={t('space.join.title')}
              description={t('space.join.description')}
              icon={ICONS.device}
              tint={colors.onSecondaryContainer}
              tintContainer={colors.secondaryContainer}
              position="last"
              onClick={() => selectMode('joinCode')}
            />
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
              shape={PILL_SHAPE}
              modifiers={[fillMaxWidth()]}
            >
              {pending ? (
                <LoadingIndicator
                  color={colors.onPrimary}
                  modifiers={[widthModifier(20), heightModifier(20)]}
                />
              ) : (
                <ComposeText>{t('space.create.action')}</ComposeText>
              )}
            </Button>
            <TextButton
              onClick={back}
              enabled={!pending}
              shape={PILL_SHAPE}
              modifiers={[fillMaxWidth()]}
            >
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
            <InvitationCodeCells
              code={invitationCode}
              nativeText={invitationCodeState}
              inputRef={invitationCodeRef}
              onValueChange={handleInvitationCodeChange}
            />
            {error ? (
              <>
                <Spacer modifiers={[heightModifier(12)]} />
                <InlineConnectionError message={error} />
              </>
            ) : null}
            <Spacer modifiers={[heightModifier(12)]} />
            <Row horizontalArrangement="center" modifiers={[fillMaxWidth()]}>
              <AssistChip onClick={() => void pasteInvitation()}>
                <AssistChip.LeadingIcon>
                  <Icon source={ICONS.paste} size={18} tint={colors.primary} />
                </AssistChip.LeadingIcon>
                <AssistChip.Label>
                  <ComposeText>{t('space.flow.pasteInvitation')}</ComposeText>
                </AssistChip.Label>
              </AssistChip>
            </Row>
            <Spacer modifiers={[heightModifier(20)]} />
            <Button
              onClick={continueFromCode}
              enabled={codeComplete}
              shape={PILL_SHAPE}
              modifiers={[fillMaxWidth()]}
            >
              <ComposeText>{t('space.flow.continue')}</ComposeText>
            </Button>
            <TextButton onClick={back} shape={PILL_SHAPE} modifiers={[fillMaxWidth()]}>
              <ComposeText>{t('action.back', { ns: 'common' })}</ComposeText>
            </TextButton>
          </Column>
        ) : null}

        {mode === 'joinDetails' ? (
          <Column
            horizontalAlignment={showsJoinStatus ? 'center' : undefined}
            modifiers={[fillMaxWidth()]}
          >
            {showsJoinStatus ? (
              <>
                <PairingStatus
                  graphic={
                    !pending && error ? (
                      <IconBadge
                        icon={ICONS.close}
                        size={HERO_BADGE_SIZE}
                        iconSize={36}
                        hero
                        tint={colors.onErrorContainer}
                        tintContainer={colors.errorContainer}
                      />
                    ) : (
                      <ContainedLoadingIndicator
                        color={colors.onPrimaryContainer}
                        containerColor={colors.primaryContainer}
                        modifiers={[size(HERO_BADGE_SIZE, HERO_BADGE_SIZE)]}
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
                      : joinTakingLonger
                      ? t('space.join.takingLonger')
                      : null
                  }
                  detail={
                    pending && !cancellingJoin ? (
                      <MetaChip
                        icon={ICONS.device}
                        label={formatInvitationCode(
                          normalizeInvitationCodeInput(invitationCode)
                        )}
                      />
                    ) : null
                  }
                />
                {pending ? (
                  <TextButton
                    onClick={cancelJoin}
                    enabled={!cancellingJoin}
                    shape={PILL_SHAPE}
                    modifiers={[fillMaxWidth()]}
                  >
                    <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
                  </TextButton>
                ) : (
                  <Button onClick={editJoinDetails} shape={PILL_SHAPE} modifiers={[fillMaxWidth()]}>
                    <ComposeText>{t('space.join.editDetails')}</ComposeText>
                  </Button>
                )}
              </>
            ) : (
              <>
                <ComposeText color={colors.onSurfaceVariant}>
                  {t('space.flow.joinDetailsBody')}
                </ComposeText>
                <Spacer modifiers={[heightModifier(12)]} />
                <InvitationCodeChip
                  code={formatInvitationCode(
                    normalizeInvitationCodeInput(invitationCode)
                  )}
                  label={t('space.field.invitationCode')}
                  editLabel={t('space.flow.editInvitationCode')}
                  onClick={back}
                />
                <Spacer modifiers={[heightModifier(12)]} />
                <OutlinedTextField
                  value={passphraseState}
                  onValueChange={setPassphrase}
                  autoFocus
                  singleLine
                  isError={Boolean(error)}
                  visualTransformation={passphraseRevealed ? 'none' : 'password'}
                  keyboardOptions={{
                    keyboardType: 'password',
                    autoCorrectEnabled: false,
                    imeAction: 'done',
                  }}
                  keyboardActions={{ onDone: () => void submitJoin() }}
                  modifiers={[fillMaxWidth()]}
                >
                  <OutlinedTextField.Label>
                    <ComposeText>{t('space.field.passphrase')}</ComposeText>
                  </OutlinedTextField.Label>
                  <OutlinedTextField.LeadingIcon>
                    <Icon source={ICONS.lock} size={20} />
                  </OutlinedTextField.LeadingIcon>
                  <OutlinedTextField.TrailingIcon>
                    <IconButton
                      onClick={() => setPassphraseRevealed((revealed) => !revealed)}
                    >
                      <Icon
                        source={passphraseRevealed ? ICONS.hide : ICONS.show}
                        size={22}
                        contentDescription={t(
                          passphraseRevealed
                            ? 'space.flow.hidePassphrase'
                            : 'space.flow.showPassphrase'
                        )}
                      />
                    </IconButton>
                  </OutlinedTextField.TrailingIcon>
                  {error ? (
                    <OutlinedTextField.SupportingText>
                      <ComposeText>{error}</ComposeText>
                    </OutlinedTextField.SupportingText>
                  ) : null}
                </OutlinedTextField>
                <Spacer modifiers={[heightModifier(8)]} />
                {editingDeviceName ? (
                  <OutlinedTextField
                    value={deviceNameState}
                    onValueChange={setDeviceName}
                    autoFocus
                    singleLine
                    keyboardOptions={{
                      capitalization: 'words',
                      imeAction: 'done',
                    }}
                    keyboardActions={{ onDone: () => void submitJoin() }}
                    modifiers={[fillMaxWidth()]}
                  >
                    <OutlinedTextField.Label>
                      <ComposeText>{t('space.field.deviceName')}</ComposeText>
                    </OutlinedTextField.Label>
                  </OutlinedTextField>
                ) : (
                  <JoinDeviceNameRow
                    label={t('space.flow.joinAsDevice', {
                      name: deviceName.trim() || defaultDeviceName,
                    })}
                    actionLabel={t('space.flow.renameDevice')}
                    onClick={() => setEditingDeviceName(true)}
                  />
                )}
                <Spacer modifiers={[heightModifier(20)]} />
                <Button
                  onClick={submitJoin}
                  enabled={canSubmitDetails}
                  shape={PILL_SHAPE}
                  modifiers={[fillMaxWidth()]}
                >
                  <ComposeText>{t('space.join.action')}</ComposeText>
                </Button>
                <TextButton onClick={back} shape={PILL_SHAPE} modifiers={[fillMaxWidth()]}>
                  <ComposeText>{t('action.back', { ns: 'common' })}</ComposeText>
                </TextButton>
              </>
            )}
          </Column>
        ) : null}

        {mode === 'invitation' && invitation ? (
          invitationExpired ? (
            <>
              <PairingStatus
                graphic={
                  <IconBadge
                    icon={ICONS.clock}
                    size={HERO_BADGE_SIZE}
                    iconSize={36}
                    hero
                    tint={colors.onErrorContainer}
                    tintContainer={colors.errorContainer}
                  />
                }
                title={t('space.flow.expired')}
                body={t('space.flow.expiredBody')}
              />
              <Spacer modifiers={[heightModifier(24)]} />
              <Button
                onClick={renewInvitation}
                enabled={!pending}
                shape={PILL_SHAPE}
                modifiers={[fillMaxWidth()]}
              >
                <Icon source={ICONS.retry} size={18} tint={colors.onPrimary} />
                <Spacer modifiers={[widthModifier(6)]} />
                <ComposeText>{t('space.flow.renewInvitation')}</ComposeText>
              </Button>
              <TextButton
                onClick={() => void completeConnection()}
                shape={PILL_SHAPE}
                modifiers={[fillMaxWidth()]}
              >
                <ComposeText>{t('space.flow.finishLater')}</ComposeText>
              </TextButton>
            </>
          ) : (
            <>
              {/* One status line replaces the device illustration, status title, and body. */}
              <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
                <LoadingIndicator
                  color={colors.primary}
                  modifiers={[size(24, 24)]}
                />
                <Spacer modifiers={[widthModifier(10)]} />
                <ComposeText color={colors.primary} style={OPTION_TITLE_STYLE}>
                  {t('space.flow.waitingForDevice')}
                </ComposeText>
              </Row>
              <Spacer modifiers={[heightModifier(16)]} />
              <InvitationCodeCard
                code={invitation.invitationCode}
                expiresLabel={t('space.flow.expiresIn', {
                  time: invitationTimeRemaining,
                })}
                copyLabel={t('space.flow.copyInvitation')}
                copied={copied}
                onCopy={copyInvitation}
              />
              <Spacer modifiers={[heightModifier(12)]} />
              <ComposeText color={colors.onSurfaceVariant}>
                {t(
                  invitation.availability === 'sameLocalNetwork'
                    ? 'space.invitation.sameLocalNetwork'
                    : 'space.invitation.crossNetwork'
                )}
              </ComposeText>
              <Spacer modifiers={[heightModifier(24)]} />
              <Button onClick={shareInvitation} shape={PILL_SHAPE} modifiers={[fillMaxWidth()]}>
                <Icon source={ICONS.share} size={18} tint={colors.onPrimary} />
                <Spacer modifiers={[widthModifier(6)]} />
                <ComposeText>{t('space.flow.shareInvitation')}</ComposeText>
              </Button>
              <TextButton
                onClick={() => void completeConnection()}
                shape={PILL_SHAPE}
                modifiers={[fillMaxWidth()]}
              >
                <ComposeText>{t('space.flow.finishLater')}</ComposeText>
              </TextButton>
            </>
          )
        ) : null}

        {mode === 'success' ? (
          <>
            <Spacer modifiers={[heightModifier(16)]} />
            <Column horizontalAlignment="center" modifiers={[fillMaxWidth()]}>
              <DevicePair
                localName={t('space.flow.thisDevice')}
                remoteName={remoteDeviceName ?? t('space.flow.otherDevice')}
                state="connected"
              />
              <Spacer modifiers={[heightModifier(18)]} />
              <ComposeText style={CONNECTED_DEVICE_STYLE} maxLines={2}>
                {t('space.flow.successTitle')}
              </ComposeText>
              <Spacer modifiers={[heightModifier(8)]} />
              <ComposeText color={colors.onSurfaceVariant} style={WAITING_STYLE}>
                {t(
                  peerUpgradeRequired
                    ? 'space.flow.peerUpgradeRequired'
                    : 'space.flow.successBody'
                )}
              </ComposeText>
            </Column>
            <Spacer modifiers={[heightModifier(24)]} />
            <Button
              onClick={() => void completeConnection()}
              shape={PILL_SHAPE}
              modifiers={[fillMaxWidth()]}
            >
              <ComposeText>{t('action.done', { ns: 'common' })}</ComposeText>
            </Button>
          </>
        ) : null}

        {mode === 'joinUpdating' ? (
          <Column horizontalAlignment="center" modifiers={[fillMaxWidth()]}>
            <Spacer modifiers={[heightModifier(16)]} />
            <PairingStatus
              graphic={
                deviceUpdate.phase === 'needsAttention' ? (
                  <IconBadge
                    icon={ICONS.close}
                    size={HERO_BADGE_SIZE}
                    iconSize={36}
                    hero
                    tint={colors.onErrorContainer}
                    tintContainer={colors.errorContainer}
                  />
                ) : (
                  <DevicePair
                    localName={t('space.flow.thisDevice')}
                    remoteName={t('space.flow.otherDevice')}
                    state="syncing"
                  />
                )
              }
              title={t(
                deviceUpdate.phase === 'needsAttention'
                  ? 'space.flow.deviceUpdate.needsAttentionTitle'
                  : 'space.flow.deviceUpdate.updatingTitle'
              )}
              body={t(
                deviceUpdate.phase === 'retryableFailure'
                  ? 'space.flow.deviceUpdate.retryingBody'
                  : deviceUpdate.phase === 'needsAttention'
                  ? `space.flow.deviceUpdate.reason.${
                      deviceUpdate.reason ?? 'deviceStateRejected'
                    }`
                  : 'space.flow.deviceUpdate.updatingBody'
              )}
            />
            <Spacer modifiers={[heightModifier(24)]} />
            {deviceUpdate.phase === 'needsAttention' ? (
              <Button onClick={close} shape={PILL_SHAPE} modifiers={[fillMaxWidth()]}>
                <ComposeText>
                  {t('space.flow.deviceUpdate.reviewAction')}
                </ComposeText>
              </Button>
            ) : null}
            <TextButton onClick={close} shape={PILL_SHAPE} modifiers={[fillMaxWidth()]}>
              <ComposeText>
                {t('space.flow.deviceUpdate.continueInBackground')}
              </ComposeText>
            </TextButton>
          </Column>
        ) : null}

        {mode === 'joinReady' ? (
          <Column horizontalAlignment="center" modifiers={[fillMaxWidth()]}>
            <Spacer modifiers={[heightModifier(16)]} />
            <IconBadge
              icon={ICONS.ready}
              size={88}
              iconSize={40}
              tint={colors.onPrimaryContainer}
              tintContainer={colors.primaryContainer}
            />
            <Spacer modifiers={[heightModifier(16)]} />
            <ComposeText style={TITLE_STYLE}>
              {t('space.flow.deviceUpdate.completedTitle')}
            </ComposeText>
            <Spacer modifiers={[heightModifier(6)]} />
            <ComposeText color={colors.onSurfaceVariant} style={WAITING_STYLE}>
              {t('space.flow.deviceUpdate.completedBody')}
            </ComposeText>
            <Spacer modifiers={[heightModifier(24)]} />
            <Button
              onClick={() => void completeConnection()}
              shape={PILL_SHAPE}
              modifiers={[fillMaxWidth()]}
            >
              <ComposeText>{t('action.done', { ns: 'common' })}</ComposeText>
            </Button>
          </Column>
        ) : null}

        {error && mode !== 'joinDetails' ? (
          <>
            <Spacer modifiers={[heightModifier(12)]} />
            <InlineConnectionError message={error} />
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
    <Host
      colorScheme={theme.isDark ? 'dark' : 'light'}
      seedColor={theme.colors.accent}
    >
      <AddSyncConnectionSheetContent {...props} />
    </Host>
  );
}
