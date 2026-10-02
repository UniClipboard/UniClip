import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { HStack, Image, Section, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import type { SpaceDeviceManagementController } from '@/components/useSpaceDeviceManagement';
import { getUnifiedSpaceService, UnifiedSpaceInputError } from '@/features/space';
import { describeRelayOverview, type RelaySummary } from '@/features/relayOverview';
import { SettingsNavRow, settingsTileColors } from '@/screens/settings/ios/common';
import type { RelaySettingsController } from './RelaySettingsPage';

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

function relaySummaryText(
  summary: RelaySummary,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (summary.kind === 'custom') return t('relay.configuredCount', { count: summary.count });
  return summary.kind === 'off' ? t('relay.status.off') : t('relay.source.builtIn');
}

/**
 * 空间设置(设备页推入):中继入口、切换空间、退出空间。低频管理项从设备页下沉到这里,
 * 让设备列表成为设备页主体。切换空间的 sheet 由 DevicesScreen 持有。
 */
export function SpaceSettingsPage({
  deviceManagement,
  relay,
  onOpenRelay,
  onSwitchSpace,
  onLeft,
}: {
  deviceManagement: SpaceDeviceManagementController;
  /** 与中继子页共用的 controller,由 DevicesScreen 持有 */
  relay: RelaySettingsController;
  onOpenRelay: () => void;
  onSwitchSpace: () => void;
  /** 已退出空间:本页的管理项不再适用,回到设备页 */
  onLeft: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The tab reads the relay overview at mount, which can precede Engine startup; read again here.
  const refreshRelay = relay.refresh;
  useEffect(() => {
    void refreshRelay().catch(() => undefined);
  }, [refreshRelay]);
  const relaySummary =
    relay.overview.status === 'ready' ? describeRelayOverview(relay.overview.value).summary : null;
  const highImpactActionsDisabled =
    !deviceManagement.highImpactActionsAvailable ||
    deviceManagement.operationInProgress ||
    deviceManagement.overview.hasPendingDecision;

  const leaveSpace = () => {
    if (leaving || deviceManagement.operationInProgress) return;
    Alert.alert(t('space.leave.action'), t('space.leave.confirm'), [
      { text: t('action.cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: t('space.leave.action'),
        style: 'destructive',
        onPress: () => {
          setLeaving(true);
          setError(null);
          void getUnifiedSpaceService()
            .leaveSpace()
            .then(onLeft)
            .catch((cause) => setError(operationError(cause, t)))
            .finally(() => setLeaving(false));
        },
      },
    ]);
  };

  return (
    <IosSheetPage title={t('space.settings.title')}>
      <IosSheetForm>
        {error ? (
          <Section>
            <HStack spacing={8}>
              <Image systemName="exclamationmark.circle.fill" size={17} color={settingsTileColors.red} />
              <SwiftUIText modifiers={[foregroundStyle(settingsTileColors.red)]}>{error}</SwiftUIText>
            </HStack>
          </Section>
        ) : null}

        <Section header={<SwiftUIText>{t('relay.page.network')}</SwiftUIText>}>
          <SettingsNavRow
            testID="relay-settings"
            icon="dot.radiowaves.left.and.right"
            title={t('relay.page.title')}
            value={relaySummary ? relaySummaryText(relaySummary, t) : undefined}
            onPress={onOpenRelay}
          />
        </Section>

        <Section
          header={<SwiftUIText>{t('space.manage.title')}</SwiftUIText>}
          footer={
            <SwiftUIText>
              {highImpactActionsDisabled ? t('space.switch.unavailable') : t('space.switch.description')}
            </SwiftUIText>
          }
        >
          <SettingsNavRow
            testID="space-switch"
            icon="arrow.triangle.2.circlepath"
            title={t('space.switch.title')}
            onPress={onSwitchSpace}
            disabled={leaving || highImpactActionsDisabled}
            showsPressFeedback={false}
          />
        </Section>

        <Section footer={<SwiftUIText>{t('space.leave.confirm')}</SwiftUIText>}>
          <SettingsNavRow
            testID="space-leave"
            icon="rectangle.portrait.and.arrow.right"
            title={t('space.leave.action')}
            onPress={leaveSpace}
            destructive
            disabled={leaving || deviceManagement.operationInProgress}
            showsChevron={false}
            showsPressFeedback={false}
          />
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
