import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  BottomSheet,
  Button as SwiftUIButton,
  Group,
  Host,
  HStack,
  Image,
  List,
  ProgressView,
  Section,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  listStyle,
  lineLimit,
  minimumScaleFactor,
  padding,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetPage } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSaturatedButtonPalette,
  iosSecondaryButtonModifiers,
} from '@/components/ui/iosButtonStyles.ios';
import type { UnifiedSpaceDevice } from '@/stores/unifiedSpaceStore';
import type { MySpaceSheetProps } from './MySpaceSheet.types';
import { useMySpaceSheet } from './useMySpaceSheet';

const DEVICE_COLOR = '#5856D6';
const ONLINE_COLOR = '#34C759';
const OFFLINE_COLOR = '#8E8E93';
const ERROR_COLOR = '#FF3B30';

function AddDeviceButton({
  label,
  onPress,
  pending,
}: {
  label: string;
  onPress: () => void;
  pending: boolean;
}) {
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        disabled(pending),
        accessibilityLabel(label),
        glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' }),
      ]}
    >
      {pending ? (
        <ProgressView modifiers={[padding()]} />
      ) : (
        <Image
          systemName="plus"
          size={18}
          color={DEVICE_COLOR}
          modifiers={[font({ weight: 'semibold' }), padding()]}
        />
      )}
    </SwiftUIButton>
  );
}

function SpaceDeviceRow({ device }: { device: UnifiedSpaceDevice }) {
  const { t } = useTranslation('settingsSync');
  const online = device.isLocal || device.online;
  const statusColor = online ? ONLINE_COLOR : OFFLINE_COLOR;

  return (
    <HStack spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
      <Image systemName="person.crop.circle" size={30} color={DEVICE_COLOR} />
      <VStack alignment="leading" spacing={4}>
        <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>{device.displayName}</SwiftUIText>
        <HStack spacing={6} alignment="center">
          <Image systemName="circle.fill" size={7} color={statusColor} />
          <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle(statusColor)]}>
            {t(online ? 'space.devices.online' : 'space.devices.offline')}
          </SwiftUIText>
        </HStack>
      </VStack>
      <Spacer />
    </HStack>
  );
}

export function MySpaceSheet({ visible, onClose }: MySpaceSheetProps) {
  const { t } = useTranslation(['home', 'settingsSync']);
  const [sheetDetent, setSheetDetent] = useState<PresentationDetent>('medium');
  const {
    devices,
    isLoading,
    refreshFailed,
    refresh,
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
  } = useMySpaceSheet(visible);

  useEffect(() => {
    if (!visible) setSheetDetent('medium');
  }, [visible]);

  useEffect(() => {
    if (invitation) setSheetDetent('large');
  }, [invitation]);

  const handleIssueInvitation = () => {
    void issueInvitation();
  };

  const presentedSheetDetent = invitation ? 'large' : sheetDetent;

  return (
    <Host style={styles.host}>
      <BottomSheet
        isPresented={visible}
        onIsPresentedChange={(presented) => {
          if (!presented) onClose();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(['medium', 'large'], {
              selection: presentedSheetDetent,
              onSelectionChange: setSheetDetent,
            }),
            presentationDragIndicator('visible'),
          ]}
        >
          <IosSheetPage
            title={t('topBar.mySpace', { ns: 'home' })}
            rightSlots={[
              <AddDeviceButton
                key="add"
                label={t('space.invitation.addA11y', { ns: 'settingsSync' })}
                onPress={handleIssueInvitation}
                pending={invitationPending}
              />,
            ]}
          >
            <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden')]}>
              {pairedDeviceName ? (
                <Section>
                  <HStack spacing={12} alignment="center">
                    <Image systemName="checkmark.circle.fill" size={28} color={ONLINE_COLOR} />
                    <VStack alignment="leading" spacing={4}>
                      <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                        {t('space.flow.successTitle', { ns: 'settingsSync' })}
                      </SwiftUIText>
                      <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                        {t('space.invitation.pairedDevice', {
                          ns: 'settingsSync',
                          device: pairedDeviceName,
                        })}
                      </SwiftUIText>
                    </VStack>
                  </HStack>
                </Section>
              ) : null}

              {invitationError ? (
                <Section>
                  <SwiftUIButton onPress={handleIssueInvitation} modifiers={[buttonStyle('plain')]}>
                    <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
                      <Image
                        systemName="exclamationmark.circle.fill"
                        size={18}
                        color={ERROR_COLOR}
                      />
                      <SwiftUIText modifiers={[foregroundStyle(ERROR_COLOR)]}>
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

              {invitation ? (
                <Section
                  header={
                    <SwiftUIText>{t('space.invitation.title', { ns: 'settingsSync' })}</SwiftUIText>
                  }
                  footer={
                    <SwiftUIText>
                      {t(
                        invitation.availability === 'sameLocalNetwork'
                          ? 'space.invitation.sameLocalNetwork'
                          : 'space.invitation.crossNetwork',
                        { ns: 'settingsSync' }
                      )}
                    </SwiftUIText>
                  }
                >
                  <VStack spacing={10} alignment="leading">
                    <SwiftUIText
                      modifiers={[font({ size: 30, weight: 'bold', design: 'monospaced' })]}
                    >
                      {invitation.invitationCode}
                    </SwiftUIText>
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t('space.invitation.pairingInstructions', { ns: 'settingsSync' })}
                    </SwiftUIText>
                    <HStack spacing={7}>
                      <Image systemName="clock" size={15} />
                      <SwiftUIText
                        modifiers={[foregroundStyle(invitationExpired ? ERROR_COLOR : 'secondary')]}
                      >
                        {invitationExpired
                          ? t('space.flow.expired', { ns: 'settingsSync' })
                          : t('space.flow.expiresIn', {
                              ns: 'settingsSync',
                              time: invitationTimeRemaining,
                            })}
                      </SwiftUIText>
                    </HStack>
                  </VStack>
                  {invitationExpired ? (
                    <SwiftUIButton
                      onPress={handleIssueInvitation}
                      modifiers={[buttonStyle('bordered')]}
                    >
                      <HStack spacing={7}>
                        <Image systemName="arrow.clockwise" size={16} />
                        <SwiftUIText>
                          {t('space.invitation.action', { ns: 'settingsSync' })}
                        </SwiftUIText>
                      </HStack>
                    </SwiftUIButton>
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
                            {t('space.flow.copyInvitation', { ns: 'settingsSync' })}
                          </SwiftUIText>
                        </HStack>
                      </SwiftUIButton>
                      <SwiftUIButton
                        onPress={() => void shareInvitation()}
                        modifiers={iosProminentButtonModifiers(
                          iosSaturatedButtonPalette(DEVICE_COLOR),
                          { fullWidth: true }
                        )}
                      >
                        <HStack spacing={7}>
                          <Image systemName="square.and.arrow.up" size={16} />
                          <SwiftUIText modifiers={[lineLimit(1), minimumScaleFactor(0.72)]}>
                            {t('space.flow.shareInvitation', { ns: 'settingsSync' })}
                          </SwiftUIText>
                        </HStack>
                      </SwiftUIButton>
                    </HStack>
                  )}
                </Section>
              ) : null}

              <Section
                header={
                  <HStack modifiers={[frame({ maxWidth: Infinity })]}>
                    <SwiftUIText>{t('space.devices.title', { ns: 'settingsSync' })}</SwiftUIText>
                    <Spacer />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {devices.length}
                    </SwiftUIText>
                  </HStack>
                }
              >
                {isLoading ? (
                  <HStack spacing={10} alignment="center">
                    <ProgressView />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t('state.loading', { ns: 'common' })}
                    </SwiftUIText>
                  </HStack>
                ) : null}

                {refreshFailed ? (
                  <SwiftUIButton onPress={() => void refresh()} modifiers={[buttonStyle('plain')]}>
                    <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
                      <Image
                        systemName="exclamationmark.circle.fill"
                        size={18}
                        color={ERROR_COLOR}
                      />
                      <SwiftUIText modifiers={[foregroundStyle(ERROR_COLOR)]}>
                        {t('space.error.operationFailed', { ns: 'settingsSync' })}
                      </SwiftUIText>
                      <Spacer />
                      <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                        {t('action.retry', { ns: 'common' })}
                      </SwiftUIText>
                    </HStack>
                  </SwiftUIButton>
                ) : null}

                {!isLoading && devices.length === 0 ? (
                  <HStack spacing={10}>
                    <Image systemName="person.2" size={18} color={OFFLINE_COLOR} />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t('space.devices.empty', { ns: 'settingsSync' })}
                    </SwiftUIText>
                  </HStack>
                ) : null}

                {devices.map((device) => (
                  <SpaceDeviceRow key={device.deviceId} device={device} />
                ))}
              </Section>
            </List>
          </IosSheetPage>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', bottom: 0, left: 0, width: 1, height: 1 },
});
