import { PlatformColor, StyleSheet, View } from 'react-native';
import {
  BottomSheet,
  Button as SwiftUIButton,
  Group,
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
  accessibilityLabel,
  accessibilityValue,
  background,
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  interactiveDismissDisabled,
  listRowInsets,
  listStyle,
  padding,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  scrollContentBackground,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { AppButton, SheetHeader } from '@/components/ui';
import type { DeviceTrustChoiceView, DeviceTrustDecisionView } from '@/features/space';
import { useTheme } from '@/hooks/useTheme';
import { iosColors, iosSystemHex } from '@/theme/iosDesignTokens';
import type { DeviceTrustDecisionProps } from './DeviceTrustDecision.types';
import type {
  DeviceTrustDecisionChoice,
  DeviceTrustDecisionSession,
} from './DeviceTrustDecisionSession';
import { useActiveDeviceTrustDecisionSession } from './useActiveDeviceTrustDecisionSession';

const BACKGROUND = iosColors?.systemGroupedBackground ?? iosSystemHex.groupedBackground.light;
const ACCENT = PlatformColor('systemBlue');
const SECONDARY = PlatformColor('secondaryLabel');
const POSITIVE = PlatformColor('systemGreen');
const WARNING = PlatformColor('systemOrange');
const DESTRUCTIVE = PlatformColor('systemRed');
const COMPACT_SHEET_FRACTION = 0.64;
const EXPANDED_SHEET_FRACTION = 0.85;

function decisionNeedsExpandedSheet(view: DeviceTrustDecisionView): boolean {
  const visibleLabels = [
    view.sourceName,
    ...view.choices.flatMap((choice) => [...choice.continueSyncNames, ...choice.stopSyncNames]),
  ];
  return visibleLabels.length > 7 || visibleLabels.join('').length > 180;
}

function HeaderActionButton({
  systemName,
  label,
  onPress,
  isDisabled = false,
}: {
  systemName: 'chevron.left' | 'xmark';
  label: string;
  onPress: () => void;
  isDisabled?: boolean;
}) {
  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        buttonStyle('plain'),
        frame({ width: 44, height: 44 }),
        contentShape(shapes.rectangle()),
        accessibilityLabel(label),
        disabled(isDisabled),
      ]}
    >
      <Image
        systemName={systemName}
        size={17}
        color={systemName === 'xmark' ? SECONDARY : ACCENT}
      />
    </SwiftUIButton>
  );
}

function ChoiceRow({
  choice,
  title,
  selected,
  submitting,
  onChoose,
}: {
  choice: DeviceTrustChoiceView;
  title: string;
  selected: boolean;
  submitting: boolean;
  onChoose: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const devices = choice.continueSyncNames.join(', ') || t('space.deviceTrust.none');

  return (
    <SwiftUIButton
      onPress={onChoose}
      modifiers={[
        buttonStyle('plain'),
        frame({ maxWidth: Infinity }),
        listRowInsets({ top: 0, bottom: 0, leading: 16, trailing: 16 }),
        accessibilityValue(selected ? 'selected' : 'not selected'),
        disabled(submitting),
      ]}
    >
      <HStack
        spacing={12}
        alignment="center"
        modifiers={[
          frame({ maxWidth: Infinity, minHeight: 68 }),
          padding({ vertical: 10 }),
          contentShape(shapes.rectangle()),
        ]}
      >
        <VStack
          spacing={5}
          alignment="leading"
          modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}
        >
          <SwiftUIText modifiers={[font({ weight: 'semibold' }), foregroundStyle('primary')]}>
            {title}
          </SwiftUIText>
          <SwiftUIText modifiers={[font({ size: 14 }), foregroundStyle('secondary')]}>
            {t('space.deviceTrust.continues', { devices })}
          </SwiftUIText>
        </VStack>
        <Spacer />
        {selected ? (
          <Image systemName="checkmark" size={17} color={ACCENT} />
        ) : (
          <HStack modifiers={[frame({ width: 17, height: 17 })]}>
            <Spacer />
          </HStack>
        )}
      </HStack>
    </SwiftUIButton>
  );
}

function SelectedImpactSection({ choice }: { choice: DeviceTrustChoiceView }) {
  const { t } = useTranslation('settingsSync');
  const hasStops = choice.stopSyncNames.length > 0;

  return (
    <Section title={t('space.deviceTrust.changesTitle')}>
      <HStack spacing={10} alignment="top">
        <Image
          systemName={hasStops ? 'xmark.circle.fill' : 'checkmark.circle.fill'}
          size={17}
          color={hasStops ? DESTRUCTIVE : POSITIVE}
        />
        <SwiftUIText modifiers={[foregroundStyle('primary')]}>
          {hasStops
            ? t('space.deviceTrust.stops', { devices: choice.stopSyncNames.join(', ') })
            : t('space.deviceTrust.noStops')}
        </SwiftUIText>
      </HStack>
    </Section>
  );
}

function ConfirmationImpactSummary({ choice }: { choice: DeviceTrustChoiceView }) {
  const { t } = useTranslation('settingsSync');

  return (
    <Section title={t('space.deviceTrust.changesTitle')}>
      {choice.stopSyncNames.length ? (
        <HStack spacing={10} alignment="top">
          <Image systemName="xmark.circle.fill" size={17} color={DESTRUCTIVE} />
          <SwiftUIText modifiers={[foregroundStyle('primary')]}>
            {t('space.deviceTrust.stops', { devices: choice.stopSyncNames.join(', ') })}
          </SwiftUIText>
        </HStack>
      ) : null}
      {choice.requiresRejoinNames.length ? (
        <HStack spacing={10} alignment="top">
          <Image systemName="arrow.clockwise.circle.fill" size={17} color={WARNING} />
          <SwiftUIText modifiers={[foregroundStyle('primary')]}>
            {t('space.deviceTrust.requiresRejoin', {
              devices: choice.requiresRejoinNames.join(', '),
            })}
          </SwiftUIText>
        </HStack>
      ) : null}
    </Section>
  );
}

function selectedActionLabel(
  selectedChoice: DeviceTrustDecisionChoice | null,
  selectedView: DeviceTrustChoiceView | undefined,
  sourceName: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!selectedChoice || !selectedView) return t('space.deviceTrust.chooseAction');
  if (selectedView.exitsCurrentSpace) return t('space.deviceTrust.reviewLeaveAction');
  if (selectedView.stopSyncNames.length) return t('space.deviceTrust.reviewStopAction');
  return selectedChoice === 'applyChange'
    ? t('space.deviceTrust.applyAction', { source: sourceName })
    : t('space.deviceTrust.keepAction');
}

function DeviceTrustDecisionContent({ decision }: { decision: DeviceTrustDecisionSession }) {
  const { t } = useTranslation('settingsSync');
  const view = decision.view;

  if (!view) return null;

  const confirming = view.choices.find((choice) => choice.choice === decision.confirmingChoice);
  const selected = view.choices.find((choice) => choice.choice === decision.selectedChoice);
  const confirmLeave = confirming?.exitsCurrentSpace ?? false;
  const actionLabel = confirmLeave
    ? t('space.deviceTrust.confirmLeaveAction')
    : decision.confirmingChoice === 'keepCurrentDeviceGroup'
    ? t('space.deviceTrust.confirmKeepAction')
    : t('space.deviceTrust.confirmStopAction');
  const footerActionLabel = decision.submitting
    ? t('space.working')
    : decision.error && !confirming
    ? t('action.retry', { ns: 'common' })
    : confirming
    ? actionLabel
    : selectedActionLabel(decision.selectedChoice, selected, view.sourceName, t);
  const closeButton = decision.dismiss ? (
    <HeaderActionButton
      systemName="xmark"
      label={t('action.close', { ns: 'common' })}
      onPress={decision.dismiss}
      isDisabled={decision.submitting}
    />
  ) : undefined;

  return (
    <VStack
      spacing={0}
      modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity }), background(BACKGROUND)]}
    >
      <SheetHeader
        title={t('space.deviceTrust.sheetTitle')}
        compactSides
        left={
          confirming ? (
            <HeaderActionButton
              systemName="chevron.left"
              label={t('action.back', { ns: 'common' })}
              onPress={decision.cancelConfirmation}
              isDisabled={decision.submitting}
            />
          ) : undefined
        }
        right={decision.dismiss ? closeButton : undefined}
      />

      <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden')]}>
        {confirming ? (
          <>
            <Section>
              <VStack spacing={8} alignment="leading" modifiers={[padding({ vertical: 4 })]}>
                <SwiftUIText modifiers={[font({ size: 22, weight: 'bold' })]}>
                  {t(
                    confirmLeave
                      ? 'space.deviceTrust.confirmLeaveTitle'
                      : 'space.deviceTrust.confirmStopTitle'
                  )}
                </SwiftUIText>
                <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                  {t(
                    confirmLeave
                      ? 'space.deviceTrust.confirmLeaveBody'
                      : 'space.deviceTrust.confirmStopBody'
                  )}
                </SwiftUIText>
              </VStack>
            </Section>
            <ConfirmationImpactSummary choice={confirming} />
          </>
        ) : (
          <>
            {decision.outcome === 'stateChanged' || decision.outcome === 'alreadyCompleted' ? (
              <Section>
                <SwiftUIText modifiers={[foregroundStyle(ACCENT)]}>
                  {t('space.deviceTrust.stateChanged')}
                </SwiftUIText>
              </Section>
            ) : null}
            {decision.error ? (
              <Section>
                <SwiftUIText modifiers={[foregroundStyle(DESTRUCTIVE)]}>
                  {t('space.deviceTrust.error')}
                </SwiftUIText>
              </Section>
            ) : null}
            <Section
              header={
                <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                  {t('space.deviceTrust.sheetBody', { source: view.sourceName })}
                </SwiftUIText>
              }
            >
              {view.choices.map((choice) => {
                const title = choice.exitsCurrentSpace
                  ? t('space.deviceTrust.leave', { source: view.sourceName })
                  : t(
                      choice.choice === 'applyChange'
                        ? 'space.deviceTrust.apply'
                        : 'space.deviceTrust.keep',
                      { source: view.sourceName }
                    );
                return (
                  <ChoiceRow
                    key={choice.choice}
                    choice={choice}
                    title={title}
                    selected={decision.selectedChoice === choice.choice}
                    submitting={decision.submitting}
                    onChoose={() => void decision.choose(choice.choice)}
                  />
                );
              })}
            </Section>
            {selected ? <SelectedImpactSection choice={selected} /> : null}
          </>
        )}
      </List>

      <VStack
        spacing={0}
        modifiers={[
          frame({ maxWidth: Infinity }),
          background(BACKGROUND),
          padding({ horizontal: 20, top: 12, bottom: 28 }),
        ]}
      >
        <AppButton
          title={footerActionLabel}
          onPress={() => void (confirming ? decision.confirm() : decision.proceed())}
          fullWidth
          size="large"
          disabled={decision.submitting || (!confirming && decision.selectedChoice === null)}
          colors={confirming ? { containerColor: DESTRUCTIVE } : undefined}
        />
      </VStack>
    </VStack>
  );
}

export function DeviceTrustDecision({ testID }: DeviceTrustDecisionProps) {
  const { theme } = useTheme();
  const decision = useActiveDeviceTrustDecisionSession();

  if (!decision.view) return null;
  const view = decision.view;
  const sheetFraction = decisionNeedsExpandedSheet(view)
    ? EXPANDED_SHEET_FRACTION
    : COMPACT_SHEET_FRACTION;

  return (
    <View testID={testID} style={styles.anchor}>
      <Host colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.host}>
        <BottomSheet isPresented onIsPresentedChange={() => undefined}>
          <Group
            modifiers={[
              presentationDetents([{ fraction: sheetFraction }]),
              presentationDragIndicator('hidden'),
              presentationBackgroundInteraction('disabled'),
              interactiveDismissDisabled(),
            ]}
          >
            <DeviceTrustDecisionContent decision={decision} />
          </Group>
        </BottomSheet>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 1,
    height: 1,
    zIndex: 100,
  },
  host: { flex: 1 },
});
