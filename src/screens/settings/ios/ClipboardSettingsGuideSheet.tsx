import React, { useEffect, useState } from 'react';
import { DynamicColorIOS, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  BottomSheet,
  Button as SwiftUIButton,
  Capsule,
  Circle,
  Divider,
  Group,
  HStack,
  Image,
  RoundedRectangle,
  ScrollView,
  Spacer,
  TabView,
  Text as SwiftUIText,
  VStack,
  ZStack,
} from '@expo/ui/swift-ui';
import {
  Animation,
  accessibilityHidden,
  animation,
  background,
  controlSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  padding,
  presentationDetents,
  presentationDragIndicator,
  shapes,
  strokeBorder,
  tabViewStyle,
  textCase,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';

import { SheetHeader } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSecondaryButtonModifiers,
} from '@/components/ui/iosButtonStyles.ios';
import { iosColors } from '@/theme/iosDesignTokens';
import { HeaderCircleButton, settingsTileColors } from './common';

export interface ClipboardSettingsGuideSheetProps {
  visible: boolean;
  onClose: () => void;
}

const GUIDE_STEPS = ['findApp', 'openPaste', 'chooseAllow'] as const;
type GuideStep = (typeof GUIDE_STEPS)[number];

/** Brand name as iOS lists it in Settings; not translated. */
const APP_NAME = 'UniClip';

const SHEET_BACKGROUND = iosColors?.systemBackground ?? '#FFFFFF';
const TIP_BACKGROUND = iosColors?.secondarySystemBackground ?? '#F2F2F7';
const MOCK_SCREEN_BACKGROUND = iosColors?.systemGroupedBackground ?? '#F2F2F7';
const MOCK_ROW_BACKGROUND = iosColors?.secondarySystemGroupedBackground ?? '#FFFFFF';
const MOCK_BORDER = iosColors?.separator ?? '#C6C6C8';
const MOCK_PLACEHOLDER = iosColors?.tertiarySystemFill ?? '#E5E5EA';
const MOCK_NEUTRAL_TILE = DynamicColorIOS({
  light: '#C7C7CC',
  dark: '#48484A',
});
const PROGRESS_TRACK = DynamicColorIOS({ light: '#E5E5EA', dark: '#3A3A3C' });
const SYSTEM_BLUE = settingsTileColors.blue;
const HIGHLIGHT_FILL = DynamicColorIOS({ light: '#E8F1FC', dark: '#0B2A4A' });
const WARNING_BACKGROUND = DynamicColorIOS({
  light: '#FFF4E5',
  dark: '#3A2A12',
});
const MOCK_ROW_HEIGHT = 40;
const MOCK_SCREEN_HEIGHT = 300;

/**
 * Step-by-step guide for setting "Paste from Other Apps" to Allow in the iOS
 * Settings app. Each page pairs a drawn Settings screen, with the row to tap
 * highlighted, and its instructions; every string in the drawing is localized
 * to match what the system shows in the user's language.
 *
 * Owned by the Settings host (a sibling of the navigation stack), never by the
 * pushed Clipboard access page, so presenting it cannot pull that page away.
 */
export function ClipboardSettingsGuideSheet({
  visible,
  onClose,
}: ClipboardSettingsGuideSheetProps) {
  const { t } = useTranslation('settingsPermissions');
  const [stepIndex, setStepIndex] = useState(0);
  const isLastStep = stepIndex === GUIDE_STEPS.length - 1;

  useEffect(() => {
    if (visible) setStepIndex(0);
  }, [visible]);

  return (
    <BottomSheet
      isPresented={visible}
      onIsPresentedChange={(presented) => {
        if (!presented) onClose();
      }}
    >
      <Group modifiers={[presentationDetents(['large']), presentationDragIndicator('visible')]}>
        <VStack
          spacing={0}
          modifiers={[
            frame({ maxWidth: Infinity, maxHeight: Infinity }),
            background(SHEET_BACKGROUND),
          ]}
        >
          <SheetHeader
            title={t('clipboardAccess.guide.title')}
            leftSlots={
              stepIndex > 0
                ? [
                    <HeaderCircleButton
                      key="back"
                      testID="clipboard-guide-back"
                      systemName="chevron.backward"
                      accessibilityLabel={t('clipboardAccess.guide.back')}
                      onPress={() => setStepIndex((current) => Math.max(0, current - 1))}
                    />,
                  ]
                : undefined
            }
            rightSlots={[
              <HeaderCircleButton
                key="close"
                testID="clipboard-guide-close"
                systemName="xmark"
                accessibilityLabel={t('clipboardAccess.guide.close')}
                onPress={onClose}
              />,
            ]}
          />
          <GuideProgress stepIndex={stepIndex} />
          <TabView
            selection={String(stepIndex)}
            onSelectionChange={(value) => setStepIndex(Number(value))}
            modifiers={[
              tabViewStyle({ type: 'page', indexDisplayMode: 'never' }),
              frame({ maxWidth: Infinity, maxHeight: Infinity }),
              animation(Animation.easeInOut({ duration: 0.3 }), stepIndex),
            ]}
          >
            {GUIDE_STEPS.map((step, index) => (
              <TabView.Tab key={step} value={String(index)}>
                <GuideStepPage step={step} />
              </TabView.Tab>
            ))}
          </TabView>
          <VStack spacing={10} modifiers={[padding({ horizontal: 20, top: 10, bottom: 16 })]}>
            <SwiftUIButton
              testID="clipboard-guide-open-settings"
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
                  {t('clipboardAccess.guide.openSettings')}
                </SwiftUIText>
                <Image systemName="arrow.up.forward" size={14} />
                <Spacer />
              </HStack>
            </SwiftUIButton>
            <SwiftUIButton
              testID="clipboard-guide-next"
              onPress={
                isLastStep
                  ? onClose
                  : () => setStepIndex((current) => Math.min(GUIDE_STEPS.length - 1, current + 1))
              }
              modifiers={[
                ...iosSecondaryButtonModifiers({ fullWidth: true }),
                controlSize('large'),
              ]}
            >
              <HStack modifiers={[frame({ maxWidth: Infinity })]}>
                <Spacer />
                <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                  {isLastStep ? t('clipboardAccess.guide.done') : t('clipboardAccess.guide.next')}
                </SwiftUIText>
                <Spacer />
              </HStack>
            </SwiftUIButton>
          </VStack>
        </VStack>
      </Group>
    </BottomSheet>
  );
}

function GuideProgress({ stepIndex }: { stepIndex: number }) {
  const { t } = useTranslation('settingsPermissions');
  return (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: 20, top: 4, bottom: 12 })]}
    >
      <SwiftUIText
        modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle('secondary')]}
      >
        {t('clipboardAccess.guide.progress', {
          current: stepIndex + 1,
          total: GUIDE_STEPS.length,
        })}
      </SwiftUIText>
      <HStack spacing={6} modifiers={[accessibilityHidden(true)]}>
        {GUIDE_STEPS.map((step, index) => (
          <Capsule
            key={step}
            modifiers={[
              foregroundStyle(index <= stepIndex ? SYSTEM_BLUE : PROGRESS_TRACK),
              frame({ maxWidth: Infinity, height: 4 }),
              animation(Animation.easeInOut({ duration: 0.3 }), stepIndex),
            ]}
          />
        ))}
      </HStack>
    </VStack>
  );
}

function GuideStepPage({ step }: { step: GuideStep }) {
  const { t } = useTranslation('settingsPermissions');
  return (
    <ScrollView modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
      <VStack
        alignment="leading"
        spacing={16}
        modifiers={[
          frame({ maxWidth: Infinity, alignment: 'leading' }),
          padding({ horizontal: 20, bottom: 12 }),
        ]}
      >
        <GuideIllustration step={step} />
        <VStack alignment="leading" spacing={8}>
          <SwiftUIText modifiers={[font({ size: 24, weight: 'bold' })]}>
            {t(`clipboardAccess.guide.steps.${step}.title`)}
          </SwiftUIText>
          <SwiftUIText modifiers={[font({ size: 15 }), foregroundStyle('secondary')]}>
            {t(`clipboardAccess.guide.steps.${step}.description`)}
          </SwiftUIText>
        </VStack>
        <GuideTip
          tone={step === 'openPaste' ? 'warning' : 'info'}
          text={t(`clipboardAccess.guide.steps.${step}.tip`)}
        />
      </VStack>
    </ScrollView>
  );
}

function GuideTip({ tone, text }: { tone: 'info' | 'warning'; text: string }) {
  const warning = tone === 'warning';
  return (
    <HStack
      spacing={10}
      alignment="top"
      modifiers={[
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        padding({ horizontal: 14, vertical: 12 }),
        background(
          warning ? WARNING_BACKGROUND : TIP_BACKGROUND,
          shapes.roundedRectangle({ cornerRadius: 14 })
        ),
      ]}
    >
      <Image
        systemName={warning ? 'exclamationmark.triangle.fill' : 'info.circle'}
        size={15}
        color={warning ? settingsTileColors.orange : undefined}
        modifiers={warning ? [] : [foregroundStyle('secondary')]}
      />
      <SwiftUIText
        modifiers={[font({ size: 13 }), frame({ maxWidth: Infinity, alignment: 'leading' })]}
      >
        {text}
      </SwiftUIText>
    </HStack>
  );
}

/** A drawn iOS Settings screen for one guide step, with the row to tap highlighted. */
function GuideIllustration({ step }: { step: GuideStep }) {
  const { t } = useTranslation('settingsPermissions');
  const label = (key: string) => t(`clipboardAccess.guide.illustration.${key}`);

  if (step === 'findApp') {
    return (
      <MockScreen backLabel={label('settings')} title={label('apps')}>
        <HStack
          spacing={6}
          modifiers={[
            frame({ maxWidth: Infinity, height: 32, alignment: 'leading' }),
            padding({ horizontal: 10 }),
            background(MOCK_PLACEHOLDER, shapes.capsule()),
          ]}
        >
          <Image
            systemName="magnifyingglass"
            size={13}
            modifiers={[foregroundStyle('secondary')]}
          />
          <SwiftUIText modifiers={[font({ size: 14 }), foregroundStyle('secondary')]}>
            {label('search')}
          </SwiftUIText>
          <Spacer />
        </HStack>
        <MockGroup>
          <MockPlaceholderRow width={72} />
          <Divider />
          <MockPlaceholderRow width={96} />
          <Divider />
          <MockHighlightedRow
            icon="doc.on.clipboard"
            iconColor={SYSTEM_BLUE}
            title={APP_NAME}
            chevron
          />
          <Divider />
          <MockPlaceholderRow width={64} />
        </MockGroup>
      </MockScreen>
    );
  }

  if (step === 'openPaste') {
    return (
      <MockScreen backLabel={label('apps')} title={APP_NAME}>
        <VStack alignment="leading" spacing={6}>
          <SwiftUIText
            modifiers={[
              font({ size: 12 }),
              foregroundStyle('secondary'),
              textCase('uppercase'),
              lineLimit(1),
              padding({ horizontal: 12 }),
            ]}
          >
            {label('accessHeader')}
          </SwiftUIText>
          <MockGroup>
            <MockPlaceholderRow width={48} />
            <Divider />
            <MockPlaceholderRow width={80} />
            <Divider />
            <MockHighlightedRow
              icon="doc.on.clipboard"
              iconColor={MOCK_NEUTRAL_TILE}
              title={label('pasteFromOtherApps')}
              value={label('ask')}
              chevron
            />
          </MockGroup>
        </VStack>
      </MockScreen>
    );
  }

  return (
    <MockScreen backLabel={APP_NAME} title={label('pasteFromOtherApps')}>
      <MockGroup>
        <MockTextRow title={label('ask')} />
        <Divider />
        <MockTextRow title={label('deny')} />
        <Divider />
        <MockHighlightedRow title={label('allow')} checked />
      </MockGroup>
    </MockScreen>
  );
}

// `strokeBorder` is a modifier that overlays the outline on the view it modifies;
// applied to a bare shape view, the shape itself still fills with the foreground
// color. Outlines therefore go on the container, never on a standalone shape.
function MockScreen({
  backLabel,
  title,
  children,
}: {
  backLabel: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <ZStack
      alignment="topLeading"
      modifiers={[
        frame({ maxWidth: Infinity, height: MOCK_SCREEN_HEIGHT }),
        strokeBorder({
          content: MOCK_BORDER,
          style: { lineWidth: 0.5 },
          shape: 'roundedRectangle',
          cornerRadius: 24,
        }),
      ]}
    >
      <RoundedRectangle cornerRadius={24} modifiers={[foregroundStyle(MOCK_SCREEN_BACKGROUND)]} />
      <VStack
        alignment="leading"
        spacing={10}
        modifiers={[
          frame({
            maxWidth: Infinity,
            maxHeight: Infinity,
            alignment: 'topLeading',
          }),
          padding({ all: 14 }),
        ]}
      >
        <HStack spacing={3}>
          <Image systemName="chevron.backward" size={12} color={SYSTEM_BLUE} />
          <SwiftUIText modifiers={[font({ size: 14 }), foregroundStyle(SYSTEM_BLUE), lineLimit(1)]}>
            {backLabel}
          </SwiftUIText>
        </HStack>
        <SwiftUIText
          modifiers={[font({ size: 24, weight: 'bold' }), lineLimit(1), minimumScaleFactor(0.6)]}
        >
          {title}
        </SwiftUIText>
        {children}
      </VStack>
    </ZStack>
  );
}

function MockGroup({ children }: { children: React.ReactNode }) {
  return (
    <VStack
      spacing={0}
      modifiers={[
        frame({ maxWidth: Infinity }),
        padding({ horizontal: 4, vertical: 2 }),
        background(MOCK_ROW_BACKGROUND, shapes.roundedRectangle({ cornerRadius: 14 })),
      ]}
    >
      {children}
    </VStack>
  );
}

function MockTileIcon({
  icon,
  color,
}: {
  icon?: SFSymbol;
  color: string | ReturnType<typeof DynamicColorIOS>;
}) {
  return (
    <ZStack modifiers={[frame({ width: 26, height: 26 })]}>
      <RoundedRectangle cornerRadius={6} modifiers={[foregroundStyle(color)]} />
      {icon ? <Image systemName={icon} size={13} color="white" /> : null}
    </ZStack>
  );
}

function MockPlaceholderRow({ width }: { width: number }) {
  return (
    <HStack
      spacing={10}
      modifiers={[
        frame({ maxWidth: Infinity, height: MOCK_ROW_HEIGHT }),
        padding({ horizontal: 8 }),
      ]}
    >
      <MockTileIcon color={MOCK_NEUTRAL_TILE} />
      <Capsule modifiers={[foregroundStyle(MOCK_PLACEHOLDER), frame({ width, height: 9 })]} />
      <Spacer />
      <Image systemName="chevron.right" size={11} modifiers={[foregroundStyle('tertiary')]} />
    </HStack>
  );
}

function MockTextRow({ title }: { title: string }) {
  return (
    <HStack
      modifiers={[
        frame({ maxWidth: Infinity, height: MOCK_ROW_HEIGHT }),
        padding({ horizontal: 10 }),
      ]}
    >
      <SwiftUIText modifiers={[font({ size: 15 }), foregroundStyle('secondary')]}>
        {title}
      </SwiftUIText>
      <Spacer />
    </HStack>
  );
}

function MockHighlightedRow({
  icon,
  iconColor,
  title,
  value,
  chevron = false,
  checked = false,
}: {
  icon?: SFSymbol;
  iconColor?: string | ReturnType<typeof DynamicColorIOS>;
  title: string;
  value?: string;
  chevron?: boolean;
  checked?: boolean;
}) {
  return (
    <ZStack
      modifiers={[
        frame({ maxWidth: Infinity, height: MOCK_ROW_HEIGHT + 4 }),
        strokeBorder({
          content: SYSTEM_BLUE,
          style: { lineWidth: 2 },
          shape: 'roundedRectangle',
          cornerRadius: 11,
        }),
      ]}
    >
      <RoundedRectangle cornerRadius={11} modifiers={[foregroundStyle(HIGHLIGHT_FILL)]} />
      <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: 8 })]}>
        {icon && iconColor ? <MockTileIcon icon={icon} color={iconColor} /> : null}
        <SwiftUIText
          modifiers={[
            font({ size: 15, weight: 'semibold' }),
            lineLimit(1),
            minimumScaleFactor(0.7),
          ]}
        >
          {title}
        </SwiftUIText>
        <Spacer />
        {value ? (
          <SwiftUIText modifiers={[font({ size: 15 }), foregroundStyle('secondary'), lineLimit(1)]}>
            {value}
          </SwiftUIText>
        ) : null}
        <TapIndicator />
        {checked ? <Image systemName="checkmark" size={15} color={SYSTEM_BLUE} /> : null}
        {chevron ? (
          <Image systemName="chevron.right" size={11} modifiers={[foregroundStyle('secondary')]} />
        ) : null}
      </HStack>
    </ZStack>
  );
}

/** Touch marker showing where to tap. */
function TapIndicator() {
  return (
    <Circle
      modifiers={[
        foregroundStyle(`${SYSTEM_BLUE}38`),
        frame({ width: 24, height: 24 }),
        strokeBorder({ content: SYSTEM_BLUE, style: { lineWidth: 2 }, shape: 'circle' }),
      ]}
    />
  );
}
