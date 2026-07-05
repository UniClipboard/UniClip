import React from 'react';
import { useTranslation } from 'react-i18next';
import { Label, LabeledContent, Section, Text as SwiftUIText, TextField } from '@expo/ui/swift-ui';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import {
  GuideStepRow,
  HeaderCircleButton,
  OpenSystemSettingsButton,
  SettingsToggle,
  StatusValue,
} from './common';
import { useKeyboardStatus } from './useKeyboardStatus';

/**
 * Keyboard-extension management: live setup status, a step-by-step enable
 * guide (iOS offers no API to enable keyboards programmatically), an in-page
 * tryout field that doubles as the status-refresh trigger, and the key
 * feedback toggles the extension reads from the App Group.
 */
export function KeyboardPage({ onBack, active = true }: { onBack: () => void; active?: boolean }) {
  const { t } = useTranslation('settingsIos');
  const { config, updateConfig } = useSettingsStore();
  // The keyboard heartbeats the App Group on appearance; poll while this page
  // is visible so trying the keyboard in the field below flips the status
  // live. The page stays mounted off-screen for the slide transition — no
  // polling there.
  const keyboard = useKeyboardStatus({ pollMs: active ? 2000 : undefined });

  const addedStatus = keyboard.added
    ? { text: t('keyboard.status.added'), tone: 'ok' as const }
    : keyboard.state === 'unknown'
      ? { text: t('keyboard.status.undetectable'), tone: 'muted' as const }
      : { text: t('keyboard.status.notAdded'), tone: 'warn' as const };

  const fullAccessStatus = !keyboard.added
    ? { text: '—', tone: 'muted' as const }
    : !keyboard.heartbeatSeen
      ? { text: t('keyboard.status.detectAfterOpen'), tone: 'muted' as const }
      : keyboard.fullAccess
        ? { text: t('keyboard.status.on'), tone: 'ok' as const }
        : { text: t('keyboard.status.off'), tone: 'warn' as const };

  const ready = keyboard.state === 'ready';

  return (
    <IosSheetPage
      title={t('keyboard.title')}
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        {/* ── 状态 ── */}
        <Section
          header={<SwiftUIText>{t('keyboard.statusSection.title')}</SwiftUIText>}
          footer={<SwiftUIText>{t('keyboard.statusSection.footer')}</SwiftUIText>}
        >
          <LabeledContent
            label={<Label title={t('keyboard.systemKeyboard')} systemImage="keyboard" />}
          >
            <StatusValue text={addedStatus.text} tone={addedStatus.tone} />
          </LabeledContent>
          <LabeledContent
            label={<Label title={t('keyboard.fullAccess')} systemImage="lock.open" />}
          >
            <StatusValue text={fullAccessStatus.text} tone={fullAccessStatus.tone} />
          </LabeledContent>
        </Section>

        {/* ── 启用步骤 ── */}
        <Section
          header={<SwiftUIText>{t('keyboard.enableSteps.title')}</SwiftUIText>}
          footer={<SwiftUIText>{t('keyboard.enableSteps.footer')}</SwiftUIText>}
        >
          <GuideStepRow index={1} text={t('keyboard.enableSteps.step1')} done={ready} />
          <GuideStepRow index={2} text={t('keyboard.enableSteps.step2')} done={keyboard.added} />
          <GuideStepRow
            index={3}
            text={t('keyboard.enableSteps.step3')}
            done={keyboard.fullAccess}
          />
          <OpenSystemSettingsButton />
        </Section>

        {/* ── 试一试 ── */}
        <Section
          header={<SwiftUIText>{t('keyboard.tryout.title')}</SwiftUIText>}
          footer={<SwiftUIText>{t('keyboard.tryout.footer')}</SwiftUIText>}
        >
          <TextField placeholder={t('keyboard.tryout.placeholder')} />
        </Section>

        {/* ── 按键反馈 ── */}
        {config ? (
          <Section
            header={<SwiftUIText>{t('keyboard.feedback.title')}</SwiftUIText>}
            footer={<SwiftUIText>{t('keyboard.feedback.footer')}</SwiftUIText>}
          >
            <SettingsToggle
              label={t('keyboard.feedback.sound')}
              systemImage="speaker.wave.2"
              isOn={config.keyboardSoundFeedback}
              onIsOnChange={(v) => updateConfig({ keyboardSoundFeedback: v })}
            />
            <SettingsToggle
              label={t('keyboard.feedback.haptic')}
              systemImage="iphone.radiowaves.left.and.right"
              isOn={config.keyboardHapticFeedback}
              onIsOnChange={(v) => updateConfig({ keyboardHapticFeedback: v })}
            />
          </Section>
        ) : null}
      </IosSheetForm>
    </IosSheetPage>
  );
}
