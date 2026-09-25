import React, { useState } from 'react';
import { DynamicColorIOS, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import {
  Button as SwiftUIButton,
  HStack,
  Image,
  Section,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  background,
  controlSize,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
  shadow,
  shapes,
} from '@expo/ui/swift-ui/modifiers';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSecondaryButtonModifiers,
} from '@/components/ui/iosButtonStyles.ios';
import { iosColors } from '@/theme/iosDesignTokens';
import { createLogger } from '@/support/observability';
import {
  HeaderCircleButton,
  SettingsIconTile,
  SettingsNavRow,
  settingsTileColors,
} from './common';

const log = createLogger('ClipboardAccess');

const PROMPT_PANEL_BACKGROUND = iosColors?.systemGroupedBackground ?? '#F2F2F7';
const PROMPT_ALERT_BACKGROUND = DynamicColorIOS({
  light: '#FFFFFF',
  dark: '#2C2C2E',
});
const PROMPT_BUTTON_BACKGROUND = iosColors?.tertiarySystemFill ?? '#E5E5EA';
const PROMPT_ALLOW_BACKGROUND = DynamicColorIOS({
  light: '#E8F1FC',
  dark: '#0B2A4A',
});
const TRIGGERED_BACKGROUND = DynamicColorIOS({
  light: '#E6F6EA',
  dark: '#12321C',
});

/**
 * "Paste from Other Apps" permission page. iOS 16+ prompts on every cross-app
 * pasteboard read unless the user sets the permission to Allow.
 *
 * Key iOS quirk this page works around: the per-app "从其他 App 粘贴" toggle
 * does NOT exist in the Settings app until the app has performed at least one
 * *content* read of the general pasteboard — a brand-new user who never copied
 * or pasted won't find that row at all. So the primary action here is an
 * in-app trigger: `getStringAsync()` reads `UIPasteboard.general.string`, which
 * both registers the app (making the Settings row appear) and surfaces the
 * one-time "允许粘贴" prompt where tapping "允许" grants the permission outright —
 * no trip to Settings needed. The Settings route (illustrated guide sheet plus a
 * deep link) is the fallback: empty pasteboard → no prompt, or a prior "不允许"
 * that iOS now remembers.
 *
 * The guide sheet is owned by the Settings host; this pushed page only reports
 * the tap through `onOpenSettingsGuide`.
 */
export function ClipboardAccessPage({
  onBack,
  onOpenSettingsGuide,
}: {
  onBack: () => void;
  onOpenSettingsGuide: () => void;
}) {
  const { t } = useTranslation('settingsPermissions');
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
      const { clipboardMonitor } = await import('@/features/clipboard');
      await clipboardMonitor.clearDenial();
    } catch (e) {
      log.warn('trigger paste read failed:', e);
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
        {/* ── 主操作:App 内触发一次,弹窗直接点「允许粘贴」 ── */}
        <Section>
          <VStack
            alignment="leading"
            spacing={16}
            modifiers={[
              frame({ maxWidth: Infinity, alignment: 'leading' }),
              padding({ vertical: 8 }),
            ]}
          >
            <HStack spacing={12}>
              <SettingsIconTile systemName="doc.on.clipboard" color={settingsTileColors.blue} />
              <SwiftUIText modifiers={[font({ size: 20, weight: 'bold' })]}>
                {t('clipboardAccess.hero.title')}
              </SwiftUIText>
            </HStack>
            <SwiftUIText modifiers={[font({ size: 15 }), foregroundStyle('secondary')]}>
              {t('clipboardAccess.hero.description')}
            </SwiftUIText>
            <PastePromptIllustration />
            {triggered ? (
              <HStack
                spacing={10}
                alignment="top"
                modifiers={[
                  frame({ maxWidth: Infinity, alignment: 'leading' }),
                  padding({ horizontal: 14, vertical: 12 }),
                  background(TRIGGERED_BACKGROUND, shapes.roundedRectangle({ cornerRadius: 14 })),
                ]}
              >
                <Image
                  systemName="checkmark.circle.fill"
                  size={18}
                  color={settingsTileColors.green}
                />
                <SwiftUIText
                  modifiers={[
                    font({ size: 15 }),
                    frame({ maxWidth: Infinity, alignment: 'leading' }),
                  ]}
                >
                  {t('clipboardAccess.hero.triggered')}
                </SwiftUIText>
              </HStack>
            ) : null}
            <SwiftUIButton
              testID="clipboard-access-trigger"
              onPress={triggerPastePermission}
              modifiers={[
                ...(triggered
                  ? iosSecondaryButtonModifiers({ fullWidth: true })
                  : iosProminentButtonModifiers(undefined, {
                      fullWidth: true,
                    })),
                controlSize('large'),
              ]}
            >
              <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
                <Spacer />
                {triggered ? null : <Image systemName="hand.tap" size={16} />}
                <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                  {triggered
                    ? t('clipboardAccess.hero.triggerAgain')
                    : t('clipboardAccess.hero.trigger')}
                </SwiftUIText>
                <Spacer />
              </HStack>
            </SwiftUIButton>
            {triggered ? null : (
              <SwiftUIText
                modifiers={[
                  font({ size: 13 }),
                  foregroundStyle('secondary'),
                  multilineTextAlignment('center'),
                  frame({ maxWidth: Infinity }),
                ]}
              >
                {t('clipboardAccess.hero.emptyClipboardHint')}
              </SwiftUIText>
            )}
          </VStack>
        </Section>

        {/* ── 兜底:图文步骤 sheet + 直达系统设置 ── */}
        <Section
          header={<SwiftUIText>{t('clipboardAccess.fallbackSection.header')}</SwiftUIText>}
          footer={<SwiftUIText>{t('clipboardAccess.fallbackSection.footer')}</SwiftUIText>}
        >
          <SettingsNavRow
            testID="clipboard-access-settings-guide"
            icon="list.number"
            iconColor={settingsTileColors.gray}
            title={t('clipboardAccess.fallbackSection.guideRow')}
            subtitle={t('clipboardAccess.fallbackSection.guideRowSubtitle')}
            onPress={onOpenSettingsGuide}
          />
          <SettingsNavRow
            testID="clipboard-access-open-settings"
            icon="gearshape.fill"
            iconColor={settingsTileColors.gray}
            title={t('clipboardAccess.fallbackSection.openSettings')}
            showsChevron={false}
            onPress={() => {
              Linking.openSettings();
            }}
          />
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}

/** Drawing of the system "Allow Paste" alert, with the button to choose outlined. */
function PastePromptIllustration() {
  const { t } = useTranslation('settingsPermissions');
  return (
    <HStack
      modifiers={[
        frame({ maxWidth: Infinity }),
        padding({ all: 16 }),
        background(PROMPT_PANEL_BACKGROUND, shapes.roundedRectangle({ cornerRadius: 18 })),
        accessibilityHidden(true),
      ]}
    >
      <Spacer />
      <VStack
        spacing={14}
        modifiers={[
          frame({ width: 260 }),
          padding({ horizontal: 14, top: 18, bottom: 14 }),
          background(PROMPT_ALERT_BACKGROUND, shapes.roundedRectangle({ cornerRadius: 26 })),
          shadow({ radius: 12, y: 6, color: '#0000001F' }),
        ]}
      >
        <VStack spacing={4}>
          <SwiftUIText
            modifiers={[font({ size: 15, weight: 'semibold' }), multilineTextAlignment('center')]}
          >
            {t('clipboardAccess.prompt.title')}
          </SwiftUIText>
          <SwiftUIText
            modifiers={[
              font({ size: 13 }),
              foregroundStyle('secondary'),
              multilineTextAlignment('center'),
            ]}
          >
            {t('clipboardAccess.prompt.message')}
          </SwiftUIText>
        </VStack>
        <HStack spacing={8}>
          <SwiftUIText
            modifiers={[
              font({ size: 13, weight: 'semibold' }),
              foregroundStyle(settingsTileColors.blue),
              multilineTextAlignment('center'),
              frame({ maxWidth: Infinity, minHeight: 40 }),
              padding({ horizontal: 6 }),
              background(PROMPT_ALLOW_BACKGROUND, shapes.capsule()),
            ]}
          >
            {t('clipboardAccess.prompt.allow')}
          </SwiftUIText>
          <SwiftUIText
            modifiers={[
              font({ size: 13, weight: 'semibold' }),
              foregroundStyle('secondary'),
              multilineTextAlignment('center'),
              frame({ maxWidth: Infinity, minHeight: 40 }),
              padding({ horizontal: 6 }),
              background(PROMPT_BUTTON_BACKGROUND, shapes.capsule()),
            ]}
          >
            {t('clipboardAccess.prompt.deny')}
          </SwiftUIText>
        </HStack>
      </VStack>
      <Spacer />
    </HStack>
  );
}
