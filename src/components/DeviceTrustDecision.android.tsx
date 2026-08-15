import {
  BasicAlertDialog,
  Button,
  CircularProgressIndicator,
  Column,
  Host,
  OutlinedButton,
  Shape,
  Spacer,
  Surface,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height as heightModifier,
  paddingAll,
  verticalScroll,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/useTheme';
import type { DeviceTrustChoiceView } from '@/features/space';
import type { DeviceTrustDecisionProps } from './DeviceTrustDecision.types';
import { useDeviceTrustDecision } from './useDeviceTrustDecision';

const DIALOG_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 28, topEnd: 28, bottomStart: 28, bottomEnd: 28 },
});
const TITLE_STYLE = { typography: 'headlineSmall' } as const;
const OPTION_TITLE_STYLE = { typography: 'titleMedium' } as const;
const DIALOG_PROPERTIES = {
  dismissOnBackPress: false,
  dismissOnClickOutside: false,
} as const;

function ImpactSummary({ choice }: { choice: DeviceTrustChoiceView }) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const none = t('space.deviceTrust.none');

  return (
    <Column>
      <ComposeText color={colors.onSurfaceVariant}>
        {t('space.deviceTrust.continues', {
          devices: choice.continueSyncNames.join(', ') || none,
        })}
      </ComposeText>
      <ComposeText color={colors.onSurfaceVariant}>
        {t('space.deviceTrust.stops', {
          devices: choice.stopSyncNames.join(', ') || none,
        })}
      </ComposeText>
      {choice.requiresRejoinNames.length ? (
        <ComposeText color={colors.onSurfaceVariant}>
          {t('space.deviceTrust.requiresRejoin', {
            devices: choice.requiresRejoinNames.join(', '),
          })}
        </ComposeText>
      ) : null}
    </Column>
  );
}

function DeviceTrustDecisionContent() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const decision = useDeviceTrustDecision();
  const view = decision.view;

  if (!view) return null;

  const confirming = view.choices.find((choice) => choice.choice === decision.confirmingChoice);
  const confirmLeave = confirming?.exitsCurrentSpace ?? false;

  return (
    <BasicAlertDialog properties={DIALOG_PROPERTIES}>
      <Surface color={colors.surfaceContainerHigh} shape={DIALOG_SHAPE}>
        <Column modifiers={[paddingAll(24), fillMaxWidth(), verticalScroll()]}>
          {confirming ? (
            <>
              <ComposeText style={TITLE_STYLE}>
                {t(
                  confirmLeave
                    ? 'space.deviceTrust.confirmLeaveTitle'
                    : 'space.deviceTrust.confirmKeepTitle'
                )}
              </ComposeText>
              <Spacer modifiers={[heightModifier(12)]} />
              <ComposeText color={colors.onSurfaceVariant}>
                {t(
                  confirmLeave
                    ? 'space.deviceTrust.confirmLeaveBody'
                    : 'space.deviceTrust.confirmKeepBody'
                )}
              </ComposeText>
              <Spacer modifiers={[heightModifier(16)]} />
              <ImpactSummary choice={confirming} />
              <Spacer modifiers={[heightModifier(24)]} />
              <Button
                onClick={() => void decision.confirm()}
                enabled={!decision.submitting}
                modifiers={[fillMaxWidth()]}
              >
                {decision.submitting ? (
                  <CircularProgressIndicator modifiers={[widthModifier(20), heightModifier(20)]} />
                ) : (
                  <ComposeText>{t('space.deviceTrust.confirm')}</ComposeText>
                )}
              </Button>
              <TextButton
                onClick={decision.cancelConfirmation}
                enabled={!decision.submitting}
                modifiers={[fillMaxWidth()]}
              >
                <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
              </TextButton>
            </>
          ) : (
            <>
              <ComposeText style={TITLE_STYLE}>{t('space.deviceTrust.title')}</ComposeText>
              <Spacer modifiers={[heightModifier(8)]} />
              <ComposeText color={colors.onSurfaceVariant}>
                {t('space.deviceTrust.body', { source: view.sourceName })}
              </ComposeText>
              <Spacer modifiers={[heightModifier(8)]} />
              <ComposeText color={colors.onSurfaceVariant}>
                {t('space.deviceTrust.targets', { devices: view.targetNames.join(', ') })}
              </ComposeText>

              {decision.outcome === 'stateChanged' || decision.outcome === 'alreadyCompleted' ? (
                <>
                  <Spacer modifiers={[heightModifier(12)]} />
                  <ComposeText color={colors.primary}>
                    {t('space.deviceTrust.stateChanged')}
                  </ComposeText>
                </>
              ) : null}
              {decision.error ? (
                <>
                  <Spacer modifiers={[heightModifier(12)]} />
                  <ComposeText color={colors.error}>{t('space.deviceTrust.error')}</ComposeText>
                </>
              ) : null}

              <Spacer modifiers={[heightModifier(20)]} />
              {view.choices.map((choice, index) => {
                const title = choice.exitsCurrentSpace
                  ? t('space.deviceTrust.leave')
                  : t(
                      choice.choice === 'applyChange'
                        ? 'space.deviceTrust.apply'
                        : 'space.deviceTrust.keep'
                    );
                const selected = decision.selectedChoice === choice.choice;
                return (
                  <Column key={choice.choice} modifiers={[fillMaxWidth()]}>
                    {selected ? (
                      <Button
                        onClick={() => void decision.choose(choice.choice)}
                        enabled={!decision.submitting}
                        modifiers={[fillMaxWidth()]}
                      >
                        <ComposeText style={OPTION_TITLE_STYLE}>{title}</ComposeText>
                      </Button>
                    ) : (
                      <OutlinedButton
                        onClick={() => void decision.choose(choice.choice)}
                        enabled={!decision.submitting}
                        modifiers={[fillMaxWidth()]}
                      >
                        <ComposeText style={OPTION_TITLE_STYLE}>{title}</ComposeText>
                      </OutlinedButton>
                    )}
                    <Spacer modifiers={[heightModifier(8)]} />
                    <ImpactSummary choice={choice} />
                    {index < view.choices.length - 1 ? (
                      <Spacer modifiers={[heightModifier(20)]} />
                    ) : null}
                  </Column>
                );
              })}
            </>
          )}
        </Column>
      </Surface>
    </BasicAlertDialog>
  );
}

export function DeviceTrustDecision(_props: DeviceTrustDecisionProps) {
  const { theme } = useTheme();

  return (
    <Host colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.colors.accent}>
      <DeviceTrustDecisionContent />
    </Host>
  );
}
