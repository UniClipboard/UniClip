import { Modal, StyleSheet, View } from 'react-native';
import {
  Button as SwiftUIButton,
  Host,
  ScrollView,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import { background, font, foregroundStyle, frame, padding } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { iosProminentButtonModifiers } from '@/components/ui/iosButtonStyles.ios';
import { useTheme } from '@/hooks/useTheme';
import type { SpaceOperationDevice } from '@/features/space/store';
import { iosColors, iosSystemHex } from '@/theme/iosDesignTokens';
import type { SpaceOperationResultProps } from './SpaceOperationResult.types';
import { useSpaceOperationResult } from './useSpaceOperationResult';

const BACKGROUND = iosColors?.systemGroupedBackground ?? iosSystemHex.groupedBackground.light;

function names(devices: SpaceOperationDevice[], none: string): string {
  return devices.map((device) => device.displayName).join(', ') || none;
}

export function SpaceOperationResult({ testID }: SpaceOperationResultProps) {
  const { t } = useTranslation('settingsSync');
  const { theme } = useTheme();
  const { result, finish } = useSpaceOperationResult();
  const none = t('space.operation.none');
  const title = result
    ? result.decisionOutcome === 'stateChanged'
      ? t('space.operation.title.stateChanged')
      : t(`space.operation.title.${result.kind}`)
    : '';

  return (
    <Modal
      visible={result !== null}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={() => undefined}
    >
      <View testID={testID} style={styles.container}>
        <Host colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.host}>
          {result ? (
            <ScrollView
              showsIndicators={false}
              modifiers={[
                frame({ maxWidth: Infinity, maxHeight: Infinity }),
                background(BACKGROUND),
              ]}
            >
              <VStack
                spacing={12}
                alignment="leading"
                modifiers={[
                  frame({ maxWidth: Infinity }),
                  padding({ horizontal: 20, vertical: 32 }),
                ]}
              >
                <SwiftUIText modifiers={[font({ size: 28, weight: 'bold' })]}>{title}</SwiftUIText>
                {result.decisionOutcome === 'stateChanged' ? (
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {t('space.operation.outcome.stateChanged')}
                  </SwiftUIText>
                ) : null}
                {result.decisionOutcome === 'alreadyCompleted' ? (
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {t('space.operation.outcome.alreadyCompleted')}
                  </SwiftUIText>
                ) : null}
                <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                  {t(
                    result.verification === 'verified'
                      ? 'space.operation.verified'
                      : 'space.operation.unverified'
                  )}
                </SwiftUIText>
                <SwiftUIText>
                  {t(
                    `space.operation.localStatus.${
                      result.localDeviceInSpace ? 'inSpace' : 'leftSpace'
                    }`
                  )}
                </SwiftUIText>
                <SwiftUIText>
                  {t('space.operation.usable', { devices: names(result.usableDevices, none) })}
                </SwiftUIText>
                <SwiftUIText>
                  {t('space.operation.separated', {
                    devices: names(result.separatedDevices, none),
                  })}
                </SwiftUIText>
                {result.continuingSpaceDevices.length ? (
                  <SwiftUIText>
                    {t('space.operation.continuing', {
                      devices: names(result.continuingSpaceDevices, none),
                    })}
                  </SwiftUIText>
                ) : null}
                {result.hasOfflineDevices ? (
                  <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                    {t('space.operation.offlinePending')}
                  </SwiftUIText>
                ) : null}
                <Spacer />
                <SwiftUIButton
                  onPress={finish}
                  modifiers={[
                    ...iosProminentButtonModifiers(undefined, { fullWidth: true }),
                    frame({ maxWidth: Infinity, minHeight: 48 }),
                  ]}
                >
                  <SwiftUIText>{t('space.operation.done')}</SwiftUIText>
                </SwiftUIButton>
              </VStack>
            </ScrollView>
          ) : null}
        </Host>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BACKGROUND },
  host: { flex: 1 },
});
