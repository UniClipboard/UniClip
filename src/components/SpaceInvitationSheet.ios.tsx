import {
  BottomSheet,
  Button as SwiftUIButton,
  Group,
  HStack,
  Image,
  ProgressView,
  Section,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSaturatedButtonPalette,
  iosSecondaryButtonModifiers,
} from '@/components/ui/iosButtonStyles.ios';
import { HeaderCircleButton, settingsTileColors, statusGreen } from '@/screens/settings/ios/common';
import { useTheme } from '@/hooks/useTheme';
import { iosSystemHex } from '@/theme/iosDesignTokens';
import { useMySpaceSheet } from './useMySpaceSheet';
import type { SpaceInvitationSheetProps } from './SpaceInvitationSheet.types';

export function SpaceInvitationSheet({ visible, onClose }: SpaceInvitationSheetProps) {
  const { t } = useTranslation('settingsSync');
  const { theme } = useTheme();
  const {
    invitation,
    invitationPending,
    invitationError,
    invitationCopied,
    invitationExpired,
    invitationTimeRemaining,
    pairedDeviceName,
    issueInvitation,
    copyInvitation,
    shareInvitation,
  } = useMySpaceSheet(visible, { issueOnOpen: true });

  return (
    <BottomSheet
      isPresented={visible}
      onIsPresentedChange={(presented) => {
        if (!presented) onClose();
      }}
    >
      <Group
        modifiers={[
          presentationDetents(['medium']),
          presentationDragIndicator('visible'),
          presentationBackground(
            theme.isDark
              ? iosSystemHex.groupedBackground.dark
              : iosSystemHex.groupedBackground.light
          ),
        ]}
      >
        <IosSheetPage
          title={t('space.invitation.title')}
          rightSlots={[
            <HeaderCircleButton
              key="close"
              systemName="xmark"
              accessibilityLabel={t('action.close', { ns: 'common' })}
              onPress={onClose}
            />,
          ]}
        >
          <IosSheetForm>
            {invitationPending && !invitation ? (
              <Section>
                <HStack spacing={10} alignment="center">
                  <ProgressView />
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {t('space.working')}
                  </SwiftUIText>
                </HStack>
              </Section>
            ) : null}

            {invitationError ? (
              <Section>
                <SwiftUIButton
                  onPress={() => void issueInvitation()}
                  modifiers={[buttonStyle('plain')]}
                >
                  <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
                    <Image
                      systemName="exclamationmark.circle.fill"
                      size={18}
                      color={settingsTileColors.red}
                    />
                    <SwiftUIText modifiers={[foregroundStyle(settingsTileColors.red)]}>
                      {invitationError}
                    </SwiftUIText>
                    <Spacer />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t('action.retry', { ns: 'common' })}
                    </SwiftUIText>
                  </HStack>
                </SwiftUIButton>
              </Section>
            ) : null}

            {pairedDeviceName ? (
              <Section>
                <VStack
                  spacing={14}
                  alignment="leading"
                  modifiers={[frame({ maxWidth: Infinity })]}
                >
                  <HStack spacing={12} alignment="center">
                    <Image systemName="checkmark.circle.fill" size={30} color={statusGreen} />
                    <VStack alignment="leading" spacing={4}>
                      <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                        {t('space.flow.successTitle')}
                      </SwiftUIText>
                      <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                        {t('space.invitation.pairedDevice', { device: pairedDeviceName })}
                      </SwiftUIText>
                    </VStack>
                  </HStack>
                  <SwiftUIButton
                    label={t('action.done', { ns: 'common' })}
                    onPress={onClose}
                    modifiers={iosProminentButtonModifiers(
                      iosSaturatedButtonPalette(settingsTileColors.indigo),
                      { fullWidth: true }
                    )}
                  />
                </VStack>
              </Section>
            ) : null}

            {invitation ? (
              <Section
                footer={
                  <SwiftUIText>
                    {t(
                      invitation.availability === 'sameLocalNetwork'
                        ? 'space.invitation.sameLocalNetwork'
                        : 'space.invitation.crossNetwork'
                    )}
                  </SwiftUIText>
                }
              >
                <VStack
                  spacing={10}
                  alignment="leading"
                  modifiers={[frame({ maxWidth: Infinity })]}
                >
                  <SwiftUIText
                    modifiers={[font({ size: 30, weight: 'bold', design: 'monospaced' })]}
                  >
                    {invitation.invitationCode}
                  </SwiftUIText>
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {t('space.invitation.pairingInstructions')}
                  </SwiftUIText>
                  <HStack spacing={7}>
                    <Image systemName="clock" size={15} />
                    <SwiftUIText
                      modifiers={[
                        foregroundStyle(invitationExpired ? settingsTileColors.red : 'secondary'),
                      ]}
                    >
                      {invitationExpired
                        ? t('space.flow.expired')
                        : t('space.flow.expiresIn', { time: invitationTimeRemaining })}
                    </SwiftUIText>
                  </HStack>
                </VStack>

                {invitationExpired ? (
                  <SwiftUIButton
                    systemImage="arrow.clockwise"
                    label={t('space.invitation.action')}
                    onPress={() => void issueInvitation()}
                    modifiers={[buttonStyle('bordered')]}
                  />
                ) : (
                  <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
                    <SwiftUIButton
                      onPress={() => void copyInvitation()}
                      modifiers={iosSecondaryButtonModifiers({ fullWidth: true })}
                    >
                      <HStack spacing={7}>
                        <Image
                          systemName={invitationCopied ? 'checkmark' : 'doc.on.doc'}
                          size={16}
                        />
                        <SwiftUIText modifiers={[lineLimit(1), minimumScaleFactor(0.72)]}>
                          {t('space.flow.copyInvitation')}
                        </SwiftUIText>
                      </HStack>
                    </SwiftUIButton>
                    <SwiftUIButton
                      onPress={() => void shareInvitation()}
                      modifiers={iosProminentButtonModifiers(
                        iosSaturatedButtonPalette(settingsTileColors.indigo),
                        { fullWidth: true }
                      )}
                    >
                      <HStack spacing={7}>
                        <Image systemName="square.and.arrow.up" size={16} />
                        <SwiftUIText modifiers={[lineLimit(1), minimumScaleFactor(0.72)]}>
                          {t('space.flow.shareInvitation')}
                        </SwiftUIText>
                      </HStack>
                    </SwiftUIButton>
                  </HStack>
                )}
              </Section>
            ) : null}
          </IosSheetForm>
        </IosSheetPage>
      </Group>
    </BottomSheet>
  );
}
