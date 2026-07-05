import React from 'react';
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
  const { config, updateConfig } = useSettingsStore();
  // The keyboard heartbeats the App Group on appearance; poll while this page
  // is visible so trying the keyboard in the field below flips the status
  // live. The page stays mounted off-screen for the slide transition — no
  // polling there.
  const keyboard = useKeyboardStatus({ pollMs: active ? 2000 : undefined });

  const addedStatus = keyboard.added
    ? { text: '已添加', tone: 'ok' as const }
    : keyboard.state === 'unknown'
      ? { text: '无法检测', tone: 'muted' as const }
      : { text: '未添加', tone: 'warn' as const };

  const fullAccessStatus = !keyboard.added
    ? { text: '—', tone: 'muted' as const }
    : !keyboard.heartbeatSeen
      ? { text: '打开键盘后可检测', tone: 'muted' as const }
      : keyboard.fullAccess
        ? { text: '已开启', tone: 'ok' as const }
        : { text: '未开启', tone: 'warn' as const };

  const ready = keyboard.state === 'ready';

  return (
    <IosSheetPage
      title="键盘"
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        {/* ── 状态 ── */}
        <Section
          header={<SwiftUIText>状态</SwiftUIText>}
          footer={
            <SwiftUIText>
              「完全访问」状态由键盘在打开时上报——如果你刚在系统设置里修改过，在下方输入框打开一次键盘即可刷新。
            </SwiftUIText>
          }
        >
          <LabeledContent label={<Label title="系统键盘" systemImage="keyboard" />}>
            <StatusValue text={addedStatus.text} tone={addedStatus.tone} />
          </LabeledContent>
          <LabeledContent label={<Label title="完全访问" systemImage="lock.open" />}>
            <StatusValue text={fullAccessStatus.text} tone={fullAccessStatus.tone} />
          </LabeledContent>
        </Section>

        {/* ── 启用步骤 ── */}
        <Section
          header={<SwiftUIText>启用步骤</SwiftUIText>}
          footer={
            <SwiftUIText>
              「允许完全访问」用于读取剪贴板并连接你的服务器，是同步功能的前提；内容只会发送到你自己配置的服务器。
            </SwiftUIText>
          }
        >
          <GuideStepRow index={1} text="打开系统设置中的 UniClip，点「键盘」" done={ready} />
          <GuideStepRow index={2} text="开启「UniClip Keyboard」" done={keyboard.added} />
          <GuideStepRow index={3} text="开启「允许完全访问」并确认" done={keyboard.fullAccess} />
          <OpenSystemSettingsButton />
        </Section>

        {/* ── 试一试 ── */}
        <Section
          header={<SwiftUIText>试一试</SwiftUIText>}
          footer={
            <SwiftUIText>
              点击输入框，长按地球键 🌐 选择「UniClip Keyboard」。键盘打开后，上方状态会自动刷新。
            </SwiftUIText>
          }
        >
          <TextField placeholder="在这里唤起键盘测试" />
        </Section>

        {/* ── 按键反馈 ── */}
        {config ? (
          <Section
            header={<SwiftUIText>按键反馈</SwiftUIText>}
            footer={<SwiftUIText>更改会在下次打开键盘时生效。</SwiftUIText>}
          >
            <SettingsToggle
              label="按键声音"
              systemImage="speaker.wave.2"
              isOn={config.keyboardSoundFeedback}
              onIsOnChange={(v) => updateConfig({ keyboardSoundFeedback: v })}
            />
            <SettingsToggle
              label="触感反馈"
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
