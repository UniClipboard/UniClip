import { Modal, StyleSheet, View } from 'react-native';
import {
  Button as SwiftUIButton,
  Host,
  ScrollView,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  background,
  disabled,
  font,
  foregroundStyle,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import {
  iosProminentButtonModifiers,
  iosSecondaryButtonModifiers,
} from '@/components/ui/iosButtonStyles.ios';
import { useTheme } from '@/hooks/useTheme';
import type { DeviceTrustChoiceView } from '@/features/space';
import { iosColors, iosSystemHex } from '@/theme/iosDesignTokens';
import type { DeviceTrustDecisionProps } from './DeviceTrustDecision.types';
import { useDeviceTrustDecision } from './useDeviceTrustDecision';

const BACKGROUND = iosColors?.systemGroupedBackground ?? iosSystemHex.groupedBackground.light;

function ImpactSummary({ choice }: { choice: DeviceTrustChoiceView }) {
  const { t } = useTranslation('settingsSync');
  const none = t('space.deviceTrust.none');

  return (
    <VStack spacing={4} alignment="leading" modifiers={[frame({ maxWidth: Infinity })]}>
      <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
        {t('space.deviceTrust.continues', {
          devices: choice.continueSyncNames.join(', ') || none,
        })}
      </SwiftUIText>
      <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
        {t('space.deviceTrust.stops', {
          devices: choice.stopSyncNames.join(', ') || none,
        })}
      </SwiftUIText>
      {choice.requiresRejoinNames.length ? (
        <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
          {t('space.deviceTrust.requiresRejoin', {
            devices: choice.requiresRejoinNames.join(', '),
          })}
        </SwiftUIText>
      ) : null}
    </VStack>
  );
}

function DeviceTrustDecisionContent({
  decision,
}: {
  decision: ReturnType<typeof useDeviceTrustDecision>;
}) {
  const { t } = useTranslation('settingsSync');
  const view = decision.view;

  if (!view) return null;

  const confirming = view.choices.find((choice) => choice.choice === decision.confirmingChoice);
  const confirmLeave = confirming?.exitsCurrentSpace ?? false;

  return (
    <ScrollView
      showsIndicators={false}
      modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background(BACKGROUND)]}
    >
      <VStack
        spacing={12}
        alignment="leading"
        modifiers={[frame({ maxWidth: Infinity }), padding({ horizontal: 20, vertical: 32 })]}
      >
        {confirming ? (
          <>
            <SwiftUIText modifiers={[font({ size: 28, weight: 'bold' })]}>
              {t(
                confirmLeave
                  ? 'space.deviceTrust.confirmLeaveTitle'
                  : 'space.deviceTrust.confirmKeepTitle'
              )}
            </SwiftUIText>
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t(
                confirmLeave
                  ? 'space.deviceTrust.confirmLeaveBody'
                  : 'space.deviceTrust.confirmKeepBody'
              )}
            </SwiftUIText>
            <ImpactSummary choice={confirming} />
            <Spacer />
            <SwiftUIButton
              onPress={() => void decision.confirm()}
              modifiers={[
                ...iosProminentButtonModifiers(undefined, { fullWidth: true }),
                frame({ maxWidth: Infinity, minHeight: 48 }),
                disabled(decision.submitting),
              ]}
            >
              <SwiftUIText>
                {decision.submitting ? t('space.working') : t('space.deviceTrust.confirm')}
              </SwiftUIText>
            </SwiftUIButton>
            <SwiftUIButton
              onPress={decision.cancelConfirmation}
              modifiers={[
                ...iosSecondaryButtonModifiers({ fullWidth: true }),
                frame({ maxWidth: Infinity, minHeight: 48 }),
                disabled(decision.submitting),
              ]}
            >
              <SwiftUIText>{t('action.cancel', { ns: 'common' })}</SwiftUIText>
            </SwiftUIButton>
          </>
        ) : (
          <>
            <SwiftUIText modifiers={[font({ size: 28, weight: 'bold' })]}>
              {t('space.deviceTrust.title')}
            </SwiftUIText>
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t('space.deviceTrust.body', { source: view.sourceName })}
            </SwiftUIText>
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
              {t('space.deviceTrust.targets', { devices: view.targetNames.join(', ') })}
            </SwiftUIText>

            {decision.outcome === 'stateChanged' || decision.outcome === 'alreadyCompleted' ? (
              <SwiftUIText modifiers={[foregroundStyle('blue')]}>
                {t('space.deviceTrust.stateChanged')}
              </SwiftUIText>
            ) : null}
            {decision.error ? (
              <SwiftUIText modifiers={[foregroundStyle('red')]}>
                {t('space.deviceTrust.error')}
              </SwiftUIText>
            ) : null}

            <Spacer />
            {view.choices.map((choice) => {
              const title = choice.exitsCurrentSpace
                ? t('space.deviceTrust.leave')
                : t(
                    choice.choice === 'applyChange'
                      ? 'space.deviceTrust.apply'
                      : 'space.deviceTrust.keep'
                  );
              return (
                <VStack
                  key={choice.choice}
                  spacing={8}
                  alignment="leading"
                  modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 6 })]}
                >
                  <SwiftUIButton
                    onPress={() => void decision.choose(choice.choice)}
                    modifiers={[
                      ...(decision.selectedChoice === choice.choice
                        ? iosProminentButtonModifiers(undefined, { fullWidth: true })
                        : iosSecondaryButtonModifiers({ fullWidth: true })),
                      frame({ maxWidth: Infinity, minHeight: 48 }),
                      disabled(decision.submitting),
                    ]}
                  >
                    <SwiftUIText>{title}</SwiftUIText>
                  </SwiftUIButton>
                  <ImpactSummary choice={choice} />
                </VStack>
              );
            })}
          </>
        )}
      </VStack>
    </ScrollView>
  );
}

export function DeviceTrustDecision({ testID }: DeviceTrustDecisionProps) {
  const { theme } = useTheme();
  const decision = useDeviceTrustDecision();

  return (
    <Modal
      visible={decision.view !== null}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={() => undefined}
    >
      <View testID={testID} style={styles.container}>
        <Host colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.host}>
          <DeviceTrustDecisionContent decision={decision} />
        </Host>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BACKGROUND },
  host: { flex: 1 },
});
