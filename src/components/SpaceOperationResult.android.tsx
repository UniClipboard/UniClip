import {
  BasicAlertDialog,
  Button,
  Column,
  Host,
  Shape,
  Spacer,
  Surface,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height,
  paddingAll,
  verticalScroll,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/hooks/useTheme';
import type { SpaceOperationDevice } from '@/features/space/store';
import type { SpaceOperationResultProps } from './SpaceOperationResult.types';
import { useSpaceOperationResult } from './useSpaceOperationResult';

const DIALOG_PROPERTIES = {
  dismissOnBackPress: false,
  dismissOnClickOutside: false,
} as const;
const DIALOG_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 28, topEnd: 28, bottomStart: 28, bottomEnd: 28 },
});
const TITLE_STYLE = { typography: 'headlineSmall' } as const;

function names(devices: SpaceOperationDevice[], none: string): string {
  return devices.map((device) => device.displayName).join(', ') || none;
}

function ResultContent() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const { result, finish } = useSpaceOperationResult();
  if (!result) return null;
  const none = t('space.operation.none');
  const title =
    result.decisionOutcome === 'stateChanged'
      ? t('space.operation.title.stateChanged')
      : t(`space.operation.title.${result.kind}`);

  return (
    <BasicAlertDialog properties={DIALOG_PROPERTIES}>
      <Surface color={colors.surfaceContainerHigh} shape={DIALOG_SHAPE}>
        <Column modifiers={[paddingAll(24), fillMaxWidth(), verticalScroll()]}>
          <ComposeText style={TITLE_STYLE}>{title}</ComposeText>
          <Spacer modifiers={[height(12)]} />
          {result.decisionOutcome === 'stateChanged' ? (
            <ComposeText color={colors.onSurfaceVariant}>
              {t('space.operation.outcome.stateChanged')}
            </ComposeText>
          ) : null}
          {result.decisionOutcome === 'alreadyCompleted' ? (
            <ComposeText color={colors.onSurfaceVariant}>
              {t('space.operation.outcome.alreadyCompleted')}
            </ComposeText>
          ) : null}
          <ComposeText color={colors.onSurfaceVariant}>
            {t(
              result.verification === 'verified'
                ? 'space.operation.verified'
                : 'space.operation.unverified'
            )}
          </ComposeText>
          <ComposeText>
            {t(
              `space.operation.localStatus.${result.localDeviceInSpace ? 'inSpace' : 'leftSpace'}`
            )}
          </ComposeText>
          <Spacer modifiers={[height(16)]} />
          <ComposeText>
            {t('space.operation.usable', { devices: names(result.usableDevices, none) })}
          </ComposeText>
          <ComposeText>
            {t('space.operation.separated', {
              devices: names(result.separatedDevices, none),
            })}
          </ComposeText>
          {result.continuingSpaceDevices.length ? (
            <ComposeText>
              {t('space.operation.continuing', {
                devices: names(result.continuingSpaceDevices, none),
              })}
            </ComposeText>
          ) : null}
          {result.hasOfflineDevices ? (
            <ComposeText color={colors.onSurfaceVariant}>
              {t('space.operation.offlinePending')}
            </ComposeText>
          ) : null}
          <Spacer modifiers={[height(24)]} />
          <Button onClick={finish} modifiers={[fillMaxWidth()]}>
            <ComposeText>{t('space.operation.done')}</ComposeText>
          </Button>
        </Column>
      </Surface>
    </BasicAlertDialog>
  );
}

export function SpaceOperationResult(_props: SpaceOperationResultProps) {
  const { theme } = useTheme();
  return (
    <Host colorScheme={theme.isDark ? 'dark' : 'light'} seedColor={theme.colors.accent}>
      <ResultContent />
    </Host>
  );
}
