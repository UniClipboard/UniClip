import React, { useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Button as SwiftUIButton, Section, Text as SwiftUIText, Toggle } from '@expo/ui/swift-ui';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { log } from '@/services/Logger';
import { useSettingsStore } from '@/stores';
import { GuideStepRow, HeaderCircleButton, OpenSystemSettingsButton } from './common';

/**
 * "Paste from Other Apps" permission guide. iOS 16+ prompts on every
 * cross-app pasteboard read unless the user sets the permission to Allow.
 *
 * Key iOS quirk this page works around: the per-app "从其他 App 粘贴" toggle
 * does NOT exist in the Settings app until the app has performed at least one
 * *content* read of the general pasteboard — a brand-new user who never copied
 * or pasted won't find that row at all. So the primary action here is an
 * in-app trigger: `getStringAsync()` reads `UIPasteboard.general.string`, which
 * both registers the app (making the Settings row appear) and surfaces the
 * one-time "允许粘贴" prompt where tapping "允许" grants the permission outright —
 * no trip to Settings needed. The Settings deep-link is kept only as a fallback
 * (empty pasteboard → no prompt, or a prior "不允许" that iOS now remembers).
 */
export function ClipboardAccessPage({ onBack }: { onBack: () => void }) {
  const { config, updateConfig } = useSettingsStore();
  const [triggered, setTriggered] = useState(false);

  /**
   * Real content read of the general pasteboard. This is the ONLY thing that
   * makes iOS register the app for the paste permission and show the system
   * "允许粘贴" prompt — `hasStrings`-style detection does neither. The value is
   * intentionally ignored; we only care about the side effect.
   */
  const triggerPastePermission = async () => {
    try {
      await Clipboard.getStringAsync();
    } catch (e) {
      log.warn('[ClipboardAccess] trigger paste read failed:', e);
    } finally {
      setTriggered(true);
    }
  };

  return (
    <IosSheetPage
      title="剪贴板访问"
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        {/* ── 主操作:App 内触发一次,弹窗直接点「允许」 ── */}
        <Section
          header={<SwiftUIText>开启「从其他 App 粘贴」</SwiftUIText>}
          footer={
            <SwiftUIText>
              iOS 只有在 App 读过一次其他 App 复制的内容后,才会弹出「允许粘贴」并把这项权限记住。全新安装、还没触发过的用户,系统设置里暂时看不到「从其他
              App 粘贴」这一项。点下面按钮触发一次:弹出「允许粘贴」时选「允许」即完成授权,之后不再询问。
            </SwiftUIText>
          }
        >
          {triggered ? (
            <GuideStepRow index={1} text="已触发一次读取。弹窗时点「允许」即可" done />
          ) : null}
          <SwiftUIButton
            systemImage="hand.tap"
            label={triggered ? '再触发一次' : '触发一次并授权'}
            onPress={triggerPastePermission}
          />
        </Section>

        {/* ── 兜底:去系统设置(触发过一次后该项才会出现) ── */}
        <Section
          header={<SwiftUIText>没弹窗,或想改选择</SwiftUIText>}
          footer={
            <SwiftUIText>
              若刚才没弹窗,可能是剪贴板为空(先复制一段文字再触发),或你之前点过「不允许」被系统记住了。到系统设置把「从其他
              App 粘贴」设为「允许」即可——触发过一次后这一项才会出现。iOS 不向 App 提供该项当前值,修改后无需返回确认。
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
