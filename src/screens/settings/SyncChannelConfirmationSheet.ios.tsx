import {
  BottomSheet,
  Button,
  Group,
  HStack,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  foregroundStyle,
  frame,
  font,
  padding,
  disabled as disabledModifier,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { iosProminentButtonModifiers } from '@/components/ui/iosButtonStyles.ios';
import type { SyncChannelConfirmationSheetProps } from './SyncChannelConfirmationSheet.types';

export function SyncChannelConfirmationSheet({
  visible,
  isConfirming = false,
  onDismiss,
  onConfirm,
}: SyncChannelConfirmationSheetProps) {
  const { t } = useTranslation('settings');

  return (
    <BottomSheet
      isPresented={visible}
      fitToContents
      onIsPresentedChange={(presented) => {
        if (!presented && !isConfirming) onDismiss();
      }}
    >
      <Group
        modifiers={[presentationDragIndicator('visible')]}
      >
        <VStack
          spacing={12}
          alignment="leading"
          modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: 20, bottom: 12 })]}
        >
          <HStack modifiers={[frame({ maxWidth: Infinity, minHeight: 44 })]}>
            <Spacer />
            <Button
              systemImage="xmark"
              onPress={onDismiss}
              modifiers={[
                buttonStyle('plain'),
                frame({ width: 44, height: 44 }),
                foregroundStyle('secondary'),
                ...(isConfirming ? [disabledModifier(true)] : []),
              ]}
            />
          </HStack>
          <VStack spacing={6} alignment="leading">
            <SwiftUIText modifiers={[font({ size: 22, weight: 'bold' })]}>
              {t('syncChannel.confirmationTitle')}
            </SwiftUIText>
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t('syncChannel.confirmationDescription')}
            </SwiftUIText>
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t('syncChannel.confirmationWarning')}
            </SwiftUIText>
          </VStack>
          <VStack
            spacing={2}
            modifiers={[frame({ maxWidth: Infinity }), padding({ top: 8 })]}
          >
            <Button
              onPress={() => void onConfirm()}
              modifiers={[
                ...iosProminentButtonModifiers(undefined, { fullWidth: true }),
                ...(isConfirming ? [disabledModifier(true)] : []),
              ]}
            >
              <HStack modifiers={[frame({ maxWidth: Infinity, minHeight: 50 })]}>
                <Spacer />
                <SwiftUIText>{t('syncChannel.confirmationConfirm')}</SwiftUIText>
                <Spacer />
              </HStack>
            </Button>
            <Button
              onPress={onDismiss}
              modifiers={[
                buttonStyle('plain'),
                foregroundStyle('secondary'),
                ...(isConfirming ? [disabledModifier(true)] : []),
              ]}
            >
              <HStack modifiers={[frame({ maxWidth: Infinity, minHeight: 44 })]}>
                <Spacer />
                <SwiftUIText>{t('syncChannel.confirmationCancel')}</SwiftUIText>
                <Spacer />
              </HStack>
            </Button>
          </VStack>
        </VStack>
      </Group>
    </BottomSheet>
  );
}
