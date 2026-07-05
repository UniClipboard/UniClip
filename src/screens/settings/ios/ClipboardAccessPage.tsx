import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { Button as SwiftUIButton, Section, Text as SwiftUIText } from '@expo/ui/swift-ui';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { log } from '@/services/Logger';
import { useSettingsStore } from '@/stores';
import {
  GuideStepRow,
  HeaderCircleButton,
  OpenSystemSettingsButton,
  SettingsToggle,
} from './common';

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
  const { t } = useTranslation('settingsPermissions');
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
      // 用户显式重新触发授权：清除监听器里「已拒绝」的记忆，让轮询恢复读取
      // （若用户这次点了「允许」，下一个 tick 即可正常同步当前内容）。
      const { clipboardMonitor } = await import('@/services/ClipboardMonitor');
      await clipboardMonitor.clearDenial();
    } catch (e) {
      log.warn('[ClipboardAccess] trigger paste read failed:', e);
    } finally {
      setTriggered(true);
    }
  };

  return (
    <IosSheetPage
      title={t('clipboardAccess.title')}
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        {/* ── 主操作:App 内触发一次,弹窗直接点「允许」 ── */}
        <Section
          header={<SwiftUIText>{t('clipboardAccess.enableSection.header')}</SwiftUIText>}
          footer={<SwiftUIText>{t('clipboardAccess.enableSection.footer')}</SwiftUIText>}
        >
          {triggered ? (
            <GuideStepRow index={1} text={t('clipboardAccess.triggeredStep')} done />
          ) : null}
          <SwiftUIButton
            systemImage="hand.tap"
            label={
              triggered ? t('clipboardAccess.triggerAgain') : t('clipboardAccess.triggerAndGrant')
            }
            onPress={triggerPastePermission}
          />
        </Section>

        {/* ── 兜底:去系统设置(触发过一次后该项才会出现) ── */}
        <Section
          header={<SwiftUIText>{t('clipboardAccess.fallbackSection.header')}</SwiftUIText>}
          footer={<SwiftUIText>{t('clipboardAccess.fallbackSection.footer')}</SwiftUIText>}
        >
          <GuideStepRow index={1} text={t('clipboardAccess.fallbackSection.step1')} />
          <GuideStepRow index={2} text={t('clipboardAccess.fallbackSection.step2')} />
          <GuideStepRow index={3} text={t('clipboardAccess.fallbackSection.step3')} />
          <OpenSystemSettingsButton />
        </Section>

        {/* ── 相关设置 ── */}
        {config ? (
          <Section
            header={<SwiftUIText>{t('clipboardAccess.relatedSection.header')}</SwiftUIText>}
            footer={<SwiftUIText>{t('clipboardAccess.relatedSection.footer')}</SwiftUIText>}
          >
            <SettingsToggle
              label={t('clipboardAccess.relatedSection.autoPushLabel')}
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
