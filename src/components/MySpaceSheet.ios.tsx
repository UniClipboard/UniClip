import React from 'react';
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
  font,
  foregroundStyle,
  frame,
  glassEffect,
  listStyle,
  padding,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetPage } from '@/components/ui';
import type { UnifiedSpaceDevice } from '@/stores/unifiedSpaceStore';
import type { MySpaceSheetProps } from './MySpaceSheet.types';
import { useMySpaceSheet } from './useMySpaceSheet';

const DEVICE_COLOR = '#5856D6';
const ONLINE_COLOR = '#34C759';
const OFFLINE_COLOR = '#8E8E93';
const ERROR_COLOR = '#FF3B30';

function CloseButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        accessibilityLabel(label),
        glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'circle' }),
      ]}
    >
      <Image
        systemName="xmark"
        size={17}
        color={OFFLINE_COLOR}
        modifiers={[font({ weight: 'semibold' }), padding()]}
      />
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
  const { devices, isLoading, refreshFailed, refresh } = useMySpaceSheet(visible);

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
            presentationDetents(['medium', 'large']),
            presentationDragIndicator('visible'),
          ]}
        >
          <IosSheetPage
            title={t('topBar.mySpace', { ns: 'home' })}
            rightSlots={[
              <CloseButton
                key="close"
                label={t('action.close', { ns: 'common' })}
                onPress={onClose}
              />,
            ]}
          >
            <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden')]}>
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
