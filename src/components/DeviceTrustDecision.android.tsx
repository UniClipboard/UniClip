import {
  BasicAlertDialog,
  Button,
  CircularProgressIndicator,
  Column,
  HorizontalDivider,
  Host,
  RadioButton,
  Row,
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
  padding,
  paddingAll,
  selectable,
  selectableGroup,
  verticalScroll,
  weight,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/useTheme';
import type { DeviceTrustChoiceView } from '@/features/space';
import type { DeviceTrustDecisionProps } from './DeviceTrustDecision.types';
import type { DeviceTrustDecisionSession } from './DeviceTrustDecisionSession';
import { useActiveDeviceTrustDecisionSession } from './useActiveDeviceTrustDecisionSession';

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

  return (
    <Column>
      {choice.continueSyncNames.length ? (
        <ComposeText color={colors.onSurfaceVariant}>
          {t('space.deviceTrust.continues', {
            devices: choice.continueSyncNames.join(', '),
          })}
        </ComposeText>
      ) : null}
      {choice.stopSyncNames.length ? (
        <ComposeText color={colors.onSurfaceVariant}>
          {t('space.deviceTrust.stops', {
            devices: choice.stopSyncNames.join(', '),
          })}
        </ComposeText>
      ) : null}
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

function DeviceTrustDecisionContent({ decision }: { decision: DeviceTrustDecisionSession }) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const view = decision.view;

  if (!view) return null;

  const confirming = view.choices.find((choice) => choice.choice === decision.confirmingChoice);
  const confirmLeave = confirming?.exitsCurrentSpace ?? false;
  const actionLabel = confirmLeave
    ? t('space.deviceTrust.confirmLeaveAction')
    : t('space.deviceTrust.confirmKeepAction');

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
                  <ComposeText>{actionLabel}</ComposeText>
                )}
              </Button>
              <TextButton
                onClick={decision.cancelConfirmation}
                enabled={!decision.submitting}
                modifiers={[fillMaxWidth()]}
              >
                <ComposeText>{t('action.back', { ns: 'common' })}</ComposeText>
              </TextButton>
              {decision.dismiss ? (
                <TextButton
                  onClick={decision.dismiss}
                  enabled={!decision.submitting}
                  modifiers={[fillMaxWidth()]}
                >
                  <ComposeText>{t('action.close', { ns: 'common' })}</ComposeText>
                </TextButton>
              ) : null}
            </>
          ) : (
            <>
              <ComposeText style={TITLE_STYLE}>{t('space.deviceTrust.title')}</ComposeText>
              <Spacer modifiers={[heightModifier(8)]} />
              <ComposeText color={colors.onSurfaceVariant}>
                {t('space.deviceTrust.body', { source: view.sourceName })}
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

              <Spacer modifiers={[heightModifier(16)]} />
              <Column modifiers={[fillMaxWidth(), selectableGroup()]}>
                {view.choices.map((choice, index) => {
                  const title = choice.exitsCurrentSpace
                    ? t('space.deviceTrust.leave', { source: view.sourceName })
                    : t(
                        choice.choice === 'applyChange'
                          ? 'space.deviceTrust.apply'
                          : 'space.deviceTrust.keep',
                        { source: view.sourceName }
                      );
                  const selected = decision.selectedChoice === choice.choice;
                  return (
                    <Column key={choice.choice} modifiers={[fillMaxWidth()]}>
                      <Row
                        verticalAlignment="center"
                        modifiers={[
                          fillMaxWidth(),
                          selectable(
                            selected,
                            () => void decision.choose(choice.choice),
                            'radioButton'
                          ),
                          padding(0, 12, 0, 12),
                        ]}
                      >
                        <RadioButton selected={selected} />
                        <Spacer modifiers={[widthModifier(12)]} />
                        <Column modifiers={[weight(1)]}>
                          <ComposeText style={OPTION_TITLE_STYLE}>{title}</ComposeText>
                          <Spacer modifiers={[heightModifier(6)]} />
                          <ImpactSummary choice={choice} />
                        </Column>
                      </Row>
                      {index < view.choices.length - 1 ? <HorizontalDivider /> : null}
                    </Column>
                  );
                })}
              </Column>
              <Spacer modifiers={[heightModifier(20)]} />
              <Button
                onClick={() => void decision.proceed()}
                enabled={decision.selectedChoice !== null && !decision.submitting}
                modifiers={[fillMaxWidth()]}
              >
                {decision.submitting ? (
                  <CircularProgressIndicator modifiers={[widthModifier(20), heightModifier(20)]} />
                ) : (
                  <ComposeText>
                    {decision.error
                      ? t('action.retry', { ns: 'common' })
                      : t('space.deviceTrust.continue')}
                  </ComposeText>
                )}
              </Button>
              {decision.dismiss ? (
                <>
                  <Spacer modifiers={[heightModifier(12)]} />
                  <TextButton onClick={decision.dismiss} modifiers={[fillMaxWidth()]}>
                    <ComposeText>{t('action.close', { ns: 'common' })}</ComposeText>
                  </TextButton>
                </>
              ) : null}
            </>
          )}
        </Column>
      </Surface>
    </BasicAlertDialog>
  );
}

export function DeviceTrustDecision(_props: DeviceTrustDecisionProps) {
  const { theme } = useTheme();
  const decision = useActiveDeviceTrustDecisionSession();

  return (
    <Host colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.colors.accent}>
      <DeviceTrustDecisionContent decision={decision} />
    </Host>
  );
}
