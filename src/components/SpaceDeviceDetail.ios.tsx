import { Modal, StyleSheet } from 'react-native';
import {
  Alert,
  Button as SwiftUIButton,
  Host,
  HStack,
  Image,
  List,
  Section,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  listStyle,
  scrollContentBackground,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetPage } from '@/components/ui';
import { HeaderCircleButton, settingsTileColors } from '@/screens/settings/ios/common';
import type { DeviceTrustDeviceView } from '@/features/space';
import type { SpaceDeviceDetailProps } from './SpaceDeviceDetail.types';

function factValue(
  device: DeviceTrustDeviceView,
  fact: 'reachability' | 'groupRelationship' | 'syncRelationship' | 'compatibility'
): string {
  return device[fact];
}

export function SpaceDeviceDetail(props: SpaceDeviceDetailProps) {
  const { t } = useTranslation('settingsSync');
  const device = props.device;
  const facts = ['reachability', 'groupRelationship', 'syncRelationship', 'compatibility'] as const;

  return (
    <Modal
      visible={device !== null}
      presentationStyle="pageSheet"
      animationType="slide"
      onRequestClose={props.removing ? () => undefined : props.onClose}
    >
      {device ? (
        <Host style={styles.host}>
          <IosSheetPage
            title={t('space.deviceDetail.title')}
            rightSlots={[
              <HeaderCircleButton
                key="close"
                systemName="xmark"
                accessibilityLabel={t('action.close', { ns: 'common' })}
                onPress={props.onClose}
              />,
            ]}
          >
            <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden')]}>
              <Section>
                <HStack spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
                  <Image
                    systemName="person.crop.circle"
                    size={38}
                    color={settingsTileColors.indigo}
                  />
                  <VStack alignment="leading" spacing={4}>
                    <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                      {device.displayName}
                    </SwiftUIText>
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t(`space.deviceTrust.status.${device.primaryStatus}`)}
                    </SwiftUIText>
                  </VStack>
                </HStack>
              </Section>

              <Section>
                <HStack modifiers={[frame({ maxWidth: Infinity })]}>
                  <SwiftUIText>{t('space.deviceDetail.identity.label')}</SwiftUIText>
                  <Spacer />
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {t(`space.deviceDetail.identity.${device.isLocal ? 'local' : 'remote'}`)}
                  </SwiftUIText>
                </HStack>
                {facts.map((fact) => (
                  <HStack key={fact} modifiers={[frame({ maxWidth: Infinity })]}>
                    <SwiftUIText>{t(`space.deviceDetail.${fact}.label`)}</SwiftUIText>
                    <Spacer />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t(`space.deviceDetail.${fact}.${factValue(device, fact)}`)}
                    </SwiftUIText>
                  </HStack>
                ))}
              </Section>

              {device.blockedReason !== null ? (
                <Section>
                  <SwiftUIText modifiers={[foregroundStyle(settingsTileColors.red)]}>
                    {t(`space.deviceDetail.blockedReason.${device.blockedReason}`)}
                  </SwiftUIText>
                </Section>
              ) : null}

              {props.removeErrorMessage ? (
                <Section>
                  <SwiftUIText modifiers={[foregroundStyle(settingsTileColors.red)]}>
                    {props.removeErrorMessage}
                  </SwiftUIText>
                </Section>
              ) : null}

              {props.canRemove ? (
                <Section footer={<SwiftUIText>{t('space.devices.removeEffect')}</SwiftUIText>}>
                  <Alert
                    title={t('space.devices.remove')}
                    isPresented={props.confirmingRemoval}
                    onIsPresentedChange={(presented) => {
                      if (!presented) props.onCancelRemove();
                    }}
                  >
                    <Alert.Trigger>
                      <SwiftUIButton
                        label={t('space.devices.remove')}
                        role="destructive"
                        onPress={props.onRequestRemove}
                        modifiers={[buttonStyle('plain'), disabled(props.removing)]}
                      />
                    </Alert.Trigger>
                    <Alert.Actions>
                      <SwiftUIButton
                        label={t('space.devices.remove')}
                        role="destructive"
                        onPress={props.onConfirmRemove}
                      />
                      <SwiftUIButton
                        label={t('action.cancel', { ns: 'common' })}
                        role="cancel"
                        onPress={props.onCancelRemove}
                      />
                    </Alert.Actions>
                    <Alert.Message>
                      <SwiftUIText>
                        {t('space.devices.removeConfirmNamed', { device: device.displayName })}
                      </SwiftUIText>
                    </Alert.Message>
                  </Alert>
                </Section>
              ) : null}
            </List>
          </IosSheetPage>
        </Host>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
});
