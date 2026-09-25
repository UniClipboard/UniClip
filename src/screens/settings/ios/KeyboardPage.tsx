import React, { useEffect, useState } from 'react';
import { AppState, DynamicColorIOS, Linking } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { useTranslation } from 'react-i18next';
import {
  Button as SwiftUIButton,
  HStack,
  Image,
  RNHostView,
  Section,
  Spacer,
  Text as SwiftUIText,
  TextField,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  aspectRatio,
  background,
  clipShape,
  controlSize,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listRowInsets,
  multilineTextAlignment,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { iosProminentButtonModifiers } from '@/components/ui/iosButtonStyles.ios';
import { useTheme } from '@/hooks/useTheme';
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
// Demo loops rendered for the keyboard (960×900). Their backgrounds match
// systemGroupedBackground in each appearance, so they blend into the panel.
const DEMO_VIDEO = {
  light: require('../../../../assets/videos/keyboard-paste-loop-light.mp4'),
  dark: require('../../../../assets/videos/keyboard-paste-loop-dark.mp4'),
};
const DEMO_VIDEO_ASPECT = 960 / 900;
// Dev clients built before expo-video was added have no ExpoVideo native
// module, and importing expo-video there throws while loading this page. Load
// the player only when the module exists; otherwise the page skips the demo.
const DemoVideoPlayer: typeof import('./KeyboardDemoVideoPlayer').KeyboardDemoVideoPlayer | null =
  requireOptionalNativeModule('ExpoVideo')
    ? require('./KeyboardDemoVideoPlayer').KeyboardDemoVideoPlayer
    : null;

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
            <KeyboardDemoVideo />
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
 * Looping demo of UniClip Keyboard: switch to it, tap a clip, and it is pasted.
 * Muted, without controls, and mixed with other audio so it never interrupts
 * the user's music. Remounted on an appearance change to swap the source.
 */
function KeyboardDemoVideo() {
  const { theme } = useTheme();
  const appearance = theme.isDark ? 'dark' : 'light';
  if (!DemoVideoPlayer) return null;
  return (
    <ZStack
      modifiers={[
        frame({ maxWidth: Infinity }),
        aspectRatio({ ratio: DEMO_VIDEO_ASPECT, contentMode: 'fit' }),
        background(guideColors.canvas),
        clipShape('roundedRectangle', 18),
        accessibilityHidden(true),
      ]}
    >
      <RNHostView>
        <DemoVideoPlayer key={appearance} source={DEMO_VIDEO[appearance]} />
      </RNHostView>
    </ZStack>
  );
}
