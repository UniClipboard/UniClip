import {
  BottomSheet,
  Button,
  Group,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  buttonStyle,
  cornerRadius,
  disabled as disabledModifier,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
  presentationDragIndicator,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import { PlatformColor } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  iosAccentButtonPalette,
  iosProminentButtonModifiers,
} from '@/components/ui/iosButtonStyles.ios';
import { iosColors } from '@/theme/iosDesignTokens';
import { settingsTileColors } from './ios/common';
import type { SyncChannelConfirmationSheetProps } from './SyncChannelConfirmationSheet.types';

/** One line of the sheet's summary: a tinted SF Symbol beside wrapping text. */
function PointRow({ systemName, color, text }: { systemName: SFSymbol; color: string; text: string }) {
  return (
    <HStack spacing={14} alignment="top" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      <Image systemName={systemName} size={20} color={color} modifiers={[frame({ width: 28, height: 24 })]} />
      <SwiftUIText
        modifiers={[
          font({ size: 15 }),
          padding({ top: 2 }),
          frame({ maxWidth: Infinity, alignment: 'leading' }),
          fixedSize({ horizontal: false, vertical: true }),
        ]}
      >
        {text}
      </SwiftUIText>
    </HStack>
  );
}

export function SyncChannelConfirmationSheet({
  visible,
  isConfirming = false,
  onDismiss,
  onConfirm,
}: SyncChannelConfirmationSheetProps) {
  const { t } = useTranslation('settings');
  const actionModifiers = isConfirming ? [disabledModifier(true)] : [];

  return (
    <BottomSheet
      isPresented={visible}
      fitToContents
      onIsPresentedChange={(presented) => {
        if (!presented && !isConfirming) onDismiss();
      }}
    >
      <Group modifiers={[presentationDragIndicator('visible')]}>
        <VStack
          spacing={24}
          modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: 24, top: 32, bottom: 12 })]}
        >
          <VStack spacing={10}>
            <Image
              systemName="point.3.connected.trianglepath.dotted"
              size={34}
              color={iosColors?.label}
              modifiers={[
                frame({ width: 64, height: 64 }),
                background(PlatformColor('tertiarySystemFill')),
                cornerRadius(32),
              ]}
            />
            <SwiftUIText
              modifiers={[
                font({ size: 12, weight: 'semibold' }),
                foregroundStyle(settingsTileColors.orange),
                padding({ horizontal: 8, vertical: 3 }),
                background(`${settingsTileColors.orange}26`, shapes.capsule()),
                padding({ top: 6 }),
              ]}
            >
              {t('syncChannel.experimentalBadge')}
            </SwiftUIText>
            <SwiftUIText
              modifiers={[font({ size: 24, weight: 'bold' }), multilineTextAlignment('center')]}
            >
              {t('syncChannel.confirmationTitle')}
            </SwiftUIText>
          </VStack>

          <VStack
            spacing={16}
            modifiers={[
              frame({ maxWidth: Infinity }),
              padding({ all: 16 }),
              background(PlatformColor('secondarySystemGroupedBackground'), shapes.roundedRectangle({ cornerRadius: 20 })),
            ]}
          >
            <PointRow
              systemName="globe"
              color={settingsTileColors.blue}
              text={t('syncChannel.confirmationDescription')}
            />
            <PointRow
              systemName="exclamationmark.triangle.fill"
              color={settingsTileColors.orange}
              text={t('syncChannel.confirmationExperimental')}
            />
            <PointRow
              systemName="arrow.uturn.backward"
              color={settingsTileColors.gray}
              text={t('syncChannel.confirmationReversible')}
            />
          </VStack>

          <VStack spacing={4} modifiers={[frame({ maxWidth: Infinity })]}>
            <Button
              testID="sync-channel-confirm"
              onPress={() => void onConfirm()}
              modifiers={[...iosProminentButtonModifiers(undefined, { fullWidth: true }), ...actionModifiers]}
            >
              <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity, minHeight: 50 })]}>
                <Spacer />
                {isConfirming ? <ProgressView modifiers={[tint(iosAccentButtonPalette.foreground)]} /> : null}
                <SwiftUIText modifiers={[font({ size: 17, weight: 'semibold' })]}>
                  {t('syncChannel.confirmationConfirm')}
                </SwiftUIText>
                <Spacer />
              </HStack>
            </Button>
            <Button
              testID="sync-channel-cancel"
              onPress={onDismiss}
              modifiers={[buttonStyle('plain'), foregroundStyle('secondary'), ...actionModifiers]}
            >
              <HStack modifiers={[frame({ maxWidth: Infinity, minHeight: 44 })]}>
                <Spacer />
                <SwiftUIText modifiers={[font({ size: 17 })]}>{t('syncChannel.confirmationCancel')}</SwiftUIText>
                <Spacer />
              </HStack>
            </Button>
          </VStack>
        </VStack>
      </Group>
    </BottomSheet>
  );
}
