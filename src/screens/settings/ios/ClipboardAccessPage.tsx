import React from 'react';
import { Section, Text as SwiftUIText, Toggle } from '@expo/ui/swift-ui';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import { GuideStepRow, HeaderCircleButton, OpenSystemSettingsButton } from './common';

/**
 * "Paste from Other Apps" permission guide. iOS 16+ prompts on every
 * cross-app pasteboard read unless the user sets the permission to Allow in
 * the Settings app; there is no API to read or change it from here, so this
 * page explains + deep-links. The auto-push toggle lives here too, because
 * it is what makes the permission matter.
 */
export function ClipboardAccessPage({ onBack }: { onBack: () => void }) {
  const { config, updateConfig } = useSettingsStore();

  return (
    <IosSheetPage
      title="剪贴板访问"
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        {/* ── 设置步骤 ── */}
        <Section
          header={<SwiftUIText>设为「允许」</SwiftUIText>}
          footer={
            <SwiftUIText>
              iOS 在 App 读取其他 App
              复制的内容时会弹出「允许粘贴」确认。把权限设为「允许」后不再反复询问。iOS 不向 App
              提供该设置的当前值，修改后无需返回确认。
            </SwiftUIText>
          }
        >
          <GuideStepRow index={1} text="打开系统设置中的 UniClip" />
          <GuideStepRow index={2} text="点「从其他 App 粘贴」" />
          <GuideStepRow index={3} text="选择「允许」" />
          <OpenSystemSettingsButton />
        </Section>

        {/* ── 相关设置 ── */}
        {config ? (
          <Section
            header={<SwiftUIText>相关设置</SwiftUIText>}
            footer={
              <SwiftUIText>
                开启后会自动读取并推送本机复制的内容，建议先把上面的权限设为「允许」。保持关闭则用主页「粘贴」按钮手动推送，iOS
                不会弹窗。
              </SwiftUIText>
            }
          >
            <Toggle
              label="自动推送本机剪贴板"
              systemImage="arrow.up.doc"
              isOn={config.autoPushLocal}
              onIsOnChange={(v) => updateConfig({ autoPushLocal: v })}
            />
          </Section>
        ) : null}
      </IosSheetForm>
    </IosSheetPage>
  );
}
