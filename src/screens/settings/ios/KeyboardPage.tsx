import React, { useEffect, useState } from 'react';
import { AppState, DynamicColorIOS, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Button as SwiftUIButton,
  HStack,
  Image,
  Section,
  Spacer,
  Text as SwiftUIText,
  TextField,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  background,
  clipShape,
  clipped,
  controlSize,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  multilineTextAlignment,
  padding,
  shadow,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { iosProminentButtonModifiers } from '@/components/ui/iosButtonStyles.ios';
import { useSettingsStore } from '@/stores';
import {
  HeaderCircleButton,
  SettingsIconTile,
  SettingsNavRow,
  IconToggleRow,
  SetupStepRow,
  settingsTileColors,
  type SetupStepState,
  type SetupStepStatus,
} from './common';
import { guideColors } from './SettingsGuideSheet';
import { useKeyboardStatus, type KeyboardStatusView } from './useKeyboardStatus';

const DETECTED_BACKGROUND = DynamicColorIOS({
  light: '#E6F6EA',
  dark: '#12321C',
});
// The keyboard drawing is UniClip Keyboard at 66% scale.
const KEYBOARD_BASE = DynamicColorIOS({ light: '#E5E5EA', dark: '#2C2C2E' });
const KEYBOARD_KEY = DynamicColorIOS({ light: '#FFFFFF', dark: '#5A5A5E' });
const KEYBOARD_WIDTH = 257;
const CLIP_CARD_WIDTH = 100;
const CLIP_CARD_HEIGHT = 108;
const KEY_GAP = 5;
// Space takes half the key row; delete and return split the other half.
const SPACE_KEY_WIDTH = (KEYBOARD_WIDTH - 16 - KEY_GAP) / 2;
const ACTION_KEY_WIDTH = (SPACE_KEY_WIDTH - KEY_GAP) / 2;

interface SetupStep {
  state: SetupStepState;
  status?: SetupStepStatus;
}

/**
 * Keyboard-extension page. Until the keyboard is ready it is one three-step
 * checklist — add it, allow Full Access, switch to it once — where every step
 * carries its own live status; iOS offers no API to do any of it for the user,
 * so the one action is opening iOS Settings. Full Access can only be read by
 * the keyboard itself, so the last step turns that limit into the action: an
 * in-page field to switch to the keyboard in, which turns green the moment its
 * heartbeat lands. Once ready, the checklist collapses to a status card, how
 * to use it, a field to try it in, and the key feedback switches.
 */
export function KeyboardPage({ onBack, active = true }: { onBack: () => void; active?: boolean }) {
  const { t } = useTranslation('settingsIos');
  // The keyboard heartbeats the App Group on appearance; poll while this page
  // is visible so switching to it in the field below flips the status live.
  // The page stays mounted off-screen for the slide transition — no polling
  // there.
  const keyboard = useKeyboardStatus({ pollMs: active ? 2000 : undefined });
  const loaded = keyboard.raw !== null;

  // Back from iOS Settings (or any trip away): Full Access may have been
  // turned off there, and the keyboard cannot report that — only a heartbeat
  // taken after the return counts. Until one lands, step 3 checks live.
  const [backFromSettingsAtMs, setBackFromSettingsAtMs] = useState<number | null>(null);
  useEffect(() => {
    let wasAway = false;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') wasAway = true;
      if (next === 'active' && wasAway) {
        wasAway = false;
        setBackFromSettingsAtMs(Date.now());
      }
    });
    return () => sub.remove();
  }, []);
  const confirmedAt = keyboard.fullAccessConfirmedAtMs;
  const ready =
    keyboard.added &&
    confirmedAt !== null &&
    (backFromSettingsAtMs === null || confirmedAt > backFromSettingsAtMs);

  // Became ready while this page was open: keep the checklist in place and
  // turn the last step green, instead of swapping the layout under the user.
  const [sawSetup, setSawSetup] = useState(false);
  useEffect(() => {
    if (loaded && !ready) setSawSetup(true);
  }, [loaded, ready]);

  return (
    <IosSheetPage
      title={t('keyboard.title')}
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        {!loaded ? null : ready && !sawSetup ? (
          <KeyboardReady />
        ) : (
          <KeyboardSetup
            keyboard={keyboard}
            ready={ready}
            backFromSettings={backFromSettingsAtMs !== null}
          />
        )}
      </IosSheetForm>
    </IosSheetPage>
  );
}

function KeyboardSetup({
  keyboard,
  ready,
  backFromSettings,
}: {
  keyboard: KeyboardStatusView;
  /** Added, with Full Access confirmed by a heartbeat since the last trip away. */
  ready: boolean;
  backFromSettings: boolean;
}) {
  const { t } = useTranslation('settingsIos');
  // The keyboard can report Full Access on, never off (see useKeyboardStatus),
  // so without a fresh confirmation the page says "not checked", never "on".
  const fullAccessOff = keyboard.fullAccessKnownOff && !backFromSettings;
  // Step 3 — switch to the keyboard here — is the live check: the next action
  // once the user is back from iOS Settings. With the system keyboard list
  // unreadable it also is the only way to confirm step 1.
  const checking = !ready && (keyboard.state === 'unknown' || (keyboard.added && backFromSettings));

  const steps: [SetupStep, SetupStep, SetupStep] = [
    keyboard.added
      ? {
          state: 'done',
          status: { text: t('keyboard.status.done'), tone: 'ok' },
        }
      : keyboard.state === 'unknown'
      ? {
          state: 'active',
          status: { text: t('keyboard.status.undetectable'), tone: 'muted' },
        }
      : {
          state: 'active',
          status: { text: t('keyboard.status.notAdded'), tone: 'warn' },
        },
    !keyboard.added
      ? { state: 'pending' }
      : ready
      ? { state: 'done', status: { text: t('keyboard.status.on'), tone: 'ok' } }
      : fullAccessOff
      ? {
          state: 'active',
          status: { text: t('keyboard.status.off'), tone: 'warn' },
        }
      : {
          state: 'active',
          status: { text: t('keyboard.status.notChecked'), tone: 'muted' },
        },
    ready
      ? {
          state: 'done',
          status: { text: t('keyboard.status.detected'), tone: 'ok' },
        }
      : checking
      ? { state: 'active' }
      : { state: 'pending' },
  ];
  const doneCount = steps.filter((step) => step.state === 'done').length;

  return (
    <>
      {keyboard.added ? (
        <Section>
          <KeyboardStatusCard
            icon={ready ? 'checkmark' : 'lock.open.fill'}
            color={ready ? settingsTileColors.green : settingsTileColors.orange}
            title={ready ? t('keyboard.ready.title') : t('keyboard.almostThere.title')}
            description={
              ready ? t('keyboard.ready.description') : t('keyboard.almostThere.description')
            }
          />
        </Section>
      ) : (
        <Section>
          <VStack
            alignment="leading"
            spacing={16}
            modifiers={[
              frame({ maxWidth: Infinity, alignment: 'leading' }),
              padding({ vertical: 8 }),
            ]}
          >
            <KeyboardIllustration />
            <VStack alignment="leading" spacing={6}>
              <SwiftUIText modifiers={[font({ size: 22, weight: 'bold' })]}>
                {t('keyboard.hero.title')}
              </SwiftUIText>
              <SwiftUIText modifiers={[font({ size: 15 }), foregroundStyle('secondary')]}>
                {t('keyboard.hero.description')}
              </SwiftUIText>
            </VStack>
          </VStack>
        </Section>
      )}

      {/* ── 三步清单:每步自带实时状态 ── */}
      <Section header={<SwiftUIText>{t('keyboard.setup.title', { done: doneCount })}</SwiftUIText>}>
        <SetupStepRow
          testID="keyboard-step-add"
          index={1}
          state={steps[0].state}
          status={steps[0].status}
          title={t('keyboard.setup.add.title')}
          subtitle={t('keyboard.setup.add.subtitle')}
        />
        <SetupStepRow
          testID="keyboard-step-full-access"
          index={2}
          state={steps[1].state}
          status={steps[1].status}
          title={t('keyboard.setup.fullAccess.title')}
          subtitle={
            steps[1].state === 'pending'
              ? t('keyboard.setup.fullAccess.subtitle')
              : t('keyboard.setup.fullAccess.path')
          }
        >
          {steps[1].state === 'active' && !checking ? <FullAccessNotes /> : null}
        </SetupStepRow>
        <SetupStepRow
          testID="keyboard-step-switch"
          index={3}
          state={steps[2].state}
          status={steps[2].status}
          title={t('keyboard.setup.switch.title')}
          subtitle={steps[2].state === 'pending' ? t('keyboard.setup.switch.subtitle') : undefined}
        >
          {steps[2].state === 'pending' ? null : <LiveCheck detected={ready} />}
        </SetupStepRow>
      </Section>

      {ready ? null : (
        // 设计稿:主按钮直接落在分组背景上,不包在白色卡片里
        <Section>
          <VStack
            spacing={8}
            modifiers={[
              frame({ maxWidth: Infinity }),
              listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
              listRowBackground('clear'),
            ]}
          >
            <SwiftUIButton
              testID="keyboard-open-settings"
              onPress={() => {
                Linking.openSettings();
              }}
              modifiers={[
                ...iosProminentButtonModifiers(undefined, { fullWidth: true }),
                controlSize('large'),
              ]}
            >
              <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
                <Spacer />
                <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                  {t('keyboard.openSettings')}
                </SwiftUIText>
                <Image systemName="arrow.up.forward" size={14} />
                <Spacer />
              </HStack>
            </SwiftUIButton>
            {keyboard.added ? null : (
              <SwiftUIText
                modifiers={[
                  font({ size: 13 }),
                  foregroundStyle('secondary'),
                  multilineTextAlignment('center'),
                  frame({ maxWidth: Infinity }),
                  padding({ horizontal: 16 }),
                ]}
              >
                {t('keyboard.openSettingsHint')}
              </SwiftUIText>
            )}
          </VStack>
        </Section>
      )}

      {keyboard.added ? <KeyFeedbackSection /> : null}
    </>
  );
}

function KeyboardReady() {
  const { t } = useTranslation('settingsIos');
  return (
    <>
      <Section>
        <KeyboardStatusCard
          icon="checkmark"
          color={settingsTileColors.green}
          title={t('keyboard.ready.title')}
          description={t('keyboard.ready.description')}
        />
      </Section>

      <Section header={<SwiftUIText>{t('keyboard.howToUse.title')}</SwiftUIText>}>
        <HStack spacing={12} alignment="top" modifiers={[frame({ maxWidth: Infinity })]}>
          <SettingsIconTile systemName="globe" color={settingsTileColors.gray} />
          <VStack
            alignment="leading"
            spacing={2}
            modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}
          >
            <SwiftUIText>{t('keyboard.howToUse.switchTitle')}</SwiftUIText>
            <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
              {t('keyboard.howToUse.switchDescription')}
            </SwiftUIText>
          </VStack>
        </HStack>
        <VStack alignment="leading" spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
          <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
            {t('keyboard.howToUse.tryLabel')}
          </SwiftUIText>
          <TryField placeholder={t('keyboard.howToUse.tryPlaceholder')} />
        </VStack>
      </Section>

      <KeyFeedbackSection />

      <Section footer={<SwiftUIText>{t('keyboard.systemSettings.footer')}</SwiftUIText>}>
        <SettingsNavRow
          testID="keyboard-system-settings"
          icon="keyboard"
          iconColor={settingsTileColors.gray}
          title={t('keyboard.systemSettings.row')}
          showsChevron={false}
          onPress={() => {
            Linking.openSettings();
          }}
        />
      </Section>
    </>
  );
}

function KeyFeedbackSection() {
  const { t } = useTranslation('settingsIos');
  const { config, updateConfig } = useSettingsStore();
  if (!config) return null;
  return (
    <Section
      header={<SwiftUIText>{t('keyboard.feedback.title')}</SwiftUIText>}
      footer={<SwiftUIText>{t('keyboard.feedback.footer')}</SwiftUIText>}
    >
      <IconToggleRow
        testID="keyboard-sound-feedback"
        icon="speaker.wave.2.fill"
        iconColor={settingsTileColors.pink}
        label={t('keyboard.feedback.sound')}
        isOn={config.keyboardSoundFeedback}
        onIsOnChange={(v) => updateConfig({ keyboardSoundFeedback: v })}
      />
      <IconToggleRow
        testID="keyboard-haptic-feedback"
        icon="iphone.radiowaves.left.and.right"
        iconColor={settingsTileColors.indigo}
        label={t('keyboard.feedback.haptic')}
        isOn={config.keyboardHapticFeedback}
        onIsOnChange={(v) => updateConfig({ keyboardHapticFeedback: v })}
      />
    </Section>
  );
}

function KeyboardStatusCard({
  icon,
  color,
  title,
  description,
}: {
  icon: SFSymbol;
  color: string;
  title: string;
  description: string;
}) {
  return (
    <HStack
      spacing={14}
      alignment="top"
      modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' }), padding({ vertical: 6 })]}
    >
      <Image
        systemName={icon}
        size={20}
        color="white"
        modifiers={[
          frame({ width: 40, height: 40 }),
          background(color, shapes.roundedRectangle({ cornerRadius: 10 })),
        ]}
      />
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}
      >
        <SwiftUIText modifiers={[font({ size: 20, weight: 'bold' })]}>{title}</SwiftUIText>
        <SwiftUIText modifiers={[font({ size: 15 }), foregroundStyle('secondary')]}>
          {description}
        </SwiftUIText>
      </VStack>
    </HStack>
  );
}

/** What Full Access is used for, next to the step that asks for it. */
function FullAccessNotes() {
  const { t } = useTranslation('settingsIos');
  const notes: { icon: SFSymbol; text: string }[] = [
    { icon: 'eye', text: t('keyboard.setup.fullAccess.readsOnly') },
    {
      icon: 'checkmark.shield',
      text: t('keyboard.setup.fullAccess.sendsOnly'),
    },
  ];
  return (
    <VStack
      alignment="leading"
      spacing={10}
      modifiers={[
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        padding({ all: 12 }),
        background(guideColors.canvas, shapes.roundedRectangle({ cornerRadius: 14 })),
      ]}
    >
      {notes.map((note) => (
        <HStack key={note.icon} spacing={10} alignment="top">
          <Image systemName={note.icon} size={14} modifiers={[foregroundStyle('secondary')]} />
          <SwiftUIText
            modifiers={[font({ size: 13 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}
          >
            {note.text}
          </SwiftUIText>
        </HStack>
      ))}
      <SwiftUIText modifiers={[font({ size: 12 }), foregroundStyle('secondary')]}>
        {t('keyboard.setup.fullAccess.systemWarning')}
      </SwiftUIText>
    </VStack>
  );
}

/**
 * The last step's action: switch to the keyboard in this field. With Full
 * Access on, the keyboard's heartbeat lands and the page's polling turns the
 * step green. With it off nothing can land, so the page can only point at the
 * keyboard's own "Full Access Required" notice.
 */
function LiveCheck({ detected }: { detected: boolean }) {
  const { t } = useTranslation('settingsIos');
  return (
    <>
      <HStack spacing={6} alignment="top">
        <Image
          systemName="globe"
          size={14}
          modifiers={[foregroundStyle('secondary'), padding({ top: 1 })]}
        />
        <SwiftUIText
          modifiers={[
            font({ size: 13 }),
            foregroundStyle('secondary'),
            frame({ maxWidth: Infinity, alignment: 'leading' }),
            fixedSize({ horizontal: false, vertical: true }),
          ]}
        >
          {t('keyboard.setup.switch.instructions')}
        </SwiftUIText>
      </HStack>
      <TryField placeholder={t('keyboard.setup.switch.placeholder')} />
      {detected ? (
        <HStack
          testID="keyboard-live-check-detected"
          spacing={10}
          alignment="top"
          modifiers={[
            frame({ maxWidth: Infinity, alignment: 'leading' }),
            padding({ horizontal: 12, vertical: 10 }),
            background(DETECTED_BACKGROUND, shapes.roundedRectangle({ cornerRadius: 14 })),
          ]}
        >
          <Image systemName="checkmark.circle.fill" size={18} color={settingsTileColors.green} />
          <SwiftUIText
            modifiers={[font({ size: 15 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}
          >
            {t('keyboard.setup.switch.detected')}
          </SwiftUIText>
        </HStack>
      ) : (
        <SwiftUIText modifiers={[font({ size: 12 }), foregroundStyle('secondary')]}>
          {t('keyboard.setup.switch.stillOffHint')}
        </SwiftUIText>
      )}
    </>
  );
}

function TryField({ placeholder }: { placeholder: string }) {
  return (
    <TextField
      placeholder={placeholder}
      modifiers={[
        padding({ horizontal: 14, vertical: 12 }),
        background(guideColors.canvas, shapes.roundedRectangle({ cornerRadius: 12 })),
      ]}
    />
  );
}

/**
 * Drawing of UniClip Keyboard as it looks today, at 66% scale: the search and
 * refresh buttons, recent clips as cards running off the trailing edge, and
 * the key row.
 */
function KeyboardIllustration() {
  const { t } = useTranslation('settingsIos');
  const label = (key: string) => t(`keyboard.illustration.${key}`);
  return (
    <HStack
      modifiers={[
        frame({ maxWidth: Infinity }),
        padding({ vertical: 16 }),
        background(guideColors.canvas, shapes.roundedRectangle({ cornerRadius: 18 })),
        accessibilityHidden(true),
      ]}
    >
      <Spacer />
      <VStack
        alignment="leading"
        spacing={0}
        modifiers={[
          frame({ width: KEYBOARD_WIDTH, height: 180, alignment: 'topLeading' }),
          background(KEYBOARD_BASE),
          clipShape('roundedRectangle', 14),
          shadow({ radius: 14, y: 7, color: '#00000024' }),
        ]}
      >
        <HStack
          modifiers={[frame({ width: KEYBOARD_WIDTH, height: 30 }), padding({ horizontal: 8 })]}
        >
          <KeyboardRoundButton systemName="magnifyingglass" />
          <Spacer />
          <KeyboardRoundButton systemName="arrow.clockwise" />
        </HStack>
        <HStack
          spacing={8}
          alignment="top"
          modifiers={[
            padding({ leading: 8, top: 3 }),
            frame({ width: KEYBOARD_WIDTH, height: 114, alignment: 'topLeading' }),
            clipped(),
          ]}
        >
          <ClipCard
            icon="text.alignleft"
            kind={label('text')}
            time={label('justNow')}
            body={label('textSample')}
            accent="secondary"
            lines={5}
          />
          <ClipCard
            icon="link"
            kind={label('links')}
            time={label('fiveMinutes')}
            body={label('linkSample')}
            accent={settingsTileColors.blue}
            lines={4}
            footer="github.com"
          />
          <VStack
            modifiers={[
              frame({ width: CLIP_CARD_WIDTH, height: CLIP_CARD_HEIGHT }),
              background(
                {
                  type: 'linearGradient',
                  colors: ['#9DB8D6', '#C8D5B9', '#E7C9A5'],
                  startPoint: { x: 0.2, y: 0 },
                  endPoint: { x: 0.8, y: 1 },
                },
                shapes.roundedRectangle({ cornerRadius: 12 })
              ),
            ]}
          >
            <Spacer />
          </VStack>
        </HStack>
        <HStack
          spacing={KEY_GAP}
          modifiers={[frame({ width: KEYBOARD_WIDTH, height: 36 }), padding({ horizontal: 8 })]}
        >
          <SwiftUIText
            modifiers={[
              font({ size: 11 }),
              foregroundStyle('secondary'),
              lineLimit(1),
              frame({ width: SPACE_KEY_WIDTH, height: 30 }),
              background(KEYBOARD_KEY, shapes.roundedRectangle({ cornerRadius: 6 })),
            ]}
          >
            {label('space')}
          </SwiftUIText>
          <Image
            systemName="delete.left"
            size={13}
            modifiers={[
              frame({ width: ACTION_KEY_WIDTH, height: 30 }),
              background(KEYBOARD_KEY, shapes.roundedRectangle({ cornerRadius: 6 })),
            ]}
          />
          <Image
            systemName="return"
            size={13}
            color="white"
            modifiers={[
              frame({ width: ACTION_KEY_WIDTH, height: 30 }),
              background(settingsTileColors.blue, shapes.roundedRectangle({ cornerRadius: 6 })),
            ]}
          />
        </HStack>
      </VStack>
      <Spacer />
    </HStack>
  );
}

function KeyboardRoundButton({ systemName }: { systemName: SFSymbol }) {
  return (
    <Image
      systemName={systemName}
      size={10}
      modifiers={[
        foregroundStyle('secondary'),
        frame({ width: 22, height: 22 }),
        background(KEYBOARD_KEY, shapes.circle()),
      ]}
    />
  );
}

function ClipCard({
  icon,
  kind,
  time,
  body,
  accent,
  lines,
  footer,
}: {
  icon: SFSymbol;
  kind: string;
  time: string;
  body: string;
  accent: string;
  lines: number;
  footer?: string;
}) {
  return (
    <VStack
      alignment="leading"
      spacing={5}
      modifiers={[
        padding({ all: 8 }),
        frame({ width: CLIP_CARD_WIDTH, height: CLIP_CARD_HEIGHT, alignment: 'topLeading' }),
        background(KEYBOARD_KEY, shapes.roundedRectangle({ cornerRadius: 12 })),
      ]}
    >
      <HStack spacing={3}>
        <Image systemName={icon} size={8} modifiers={[foregroundStyle(accent)]} />
        <SwiftUIText
          modifiers={[font({ size: 8, weight: 'semibold' }), foregroundStyle(accent), lineLimit(1)]}
        >
          {kind}
        </SwiftUIText>
        <SwiftUIText modifiers={[font({ size: 7 }), foregroundStyle('tertiary'), lineLimit(1)]}>
          {time}
        </SwiftUIText>
      </HStack>
      <SwiftUIText modifiers={[font({ size: 10.5 }), lineLimit(lines)]}>{body}</SwiftUIText>
      {footer ? (
        <>
          <Spacer />
          <SwiftUIText
            modifiers={[font({ size: 7 }), foregroundStyle(settingsTileColors.blue), lineLimit(1)]}
          >
            {footer}
          </SwiftUIText>
        </>
      ) : null}
    </VStack>
  );
}
