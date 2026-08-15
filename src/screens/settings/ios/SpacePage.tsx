import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import {
  Button as SwiftUIButton,
  HStack,
  Image,
  ProgressView,
  Section,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityHint,
  accessibilityLabel,
  buttonStyle,
  contentShape,
  controlSize,
  font,
  foregroundStyle,
  frame,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import type { SpaceDeviceManagementController } from '@/components/useSpaceDeviceManagement';
import { IosSheetForm, IosSheetPage } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSaturatedButtonPalette,
} from '@/components/ui/iosButtonStyles.ios';
import {
  getUnifiedSpaceService,
  UnifiedSpaceInputError,
  useUnifiedSpaceStore,
  type DeviceTrustDeviceView,
} from '@/features/space';
import {
  HeaderCircleButton,
  SettingsIconTile,
  SettingsNavRow,
  chevronColor,
  settingsTileColors,
  statusGreen,
} from './common';
import { CustomRelaySection } from '../CustomRelaySection';

type PendingOperation = 'leave' | null;

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

function SpaceDeviceRow({
  device,
  removing,
  manageHint,
  thisDeviceLabel,
  onlineLabel,
  offlineLabel,
  manageable,
  onManage,
}: {
  device: DeviceTrustDeviceView;
  removing: boolean;
  manageHint: string;
  thisDeviceLabel: string;
  onlineLabel: string;
  offlineLabel: string;
  manageable: boolean;
  onManage: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const online = device.isLocal || device.reachability === 'online';
  const trustStatus = device.primaryStatus !== 'usable' && device.primaryStatus !== 'unknown';
  const statusColor = trustStatus
    ? settingsTileColors.red
    : online
    ? statusGreen
    : settingsTileColors.gray;
  const statusLabel = trustStatus
    ? t(`space.deviceTrust.status.${device.primaryStatus}`)
    : device.isLocal
    ? thisDeviceLabel
    : online
    ? onlineLabel
    : offlineLabel;
  const rowModifiers = [frame({ maxWidth: Infinity })];

  if (manageable && !removing) {
    rowModifiers.push(
      contentShape(shapes.rectangle()),
      onTapGesture(onManage),
      accessibilityLabel(device.displayName),
      accessibilityHint(manageHint)
    );
  }

  return (
    <HStack spacing={12} alignment="center" modifiers={rowModifiers}>
      <Image systemName="person.crop.circle" size={30} color={settingsTileColors.indigo} />
      <VStack alignment="leading" spacing={3}>
        <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>{device.displayName}</SwiftUIText>
        <HStack spacing={5} alignment="center">
          <Image systemName="circle.fill" size={7} color={statusColor} />
          <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
            {statusLabel}
          </SwiftUIText>
        </HStack>
      </VStack>
      <Spacer />
      {manageable ? (
        removing ? (
          <ProgressView />
        ) : (
          <Image systemName="chevron.right" size={12} color={chevronColor} />
        )
      ) : null}
    </HStack>
  );
}

export function SpacePage({
  initialDeviceId,
  notificationNavigationRequestId,
  onBack,
  onOpenInvitation,
  onOpenSetup,
  deviceManagement,
}: {
  initialDeviceId?: string;
  notificationNavigationRequestId?: number;
  onBack: () => void;
  onOpenInvitation: () => void;
  onOpenSetup: (mode: AddSyncConnectionMode) => void;
  deviceManagement: SpaceDeviceManagementController;
}) {
  const { t } = useTranslation('settingsSync');
  const [pending, setPending] = useState<PendingOperation>(null);
  const [error, setError] = useState<string | null>(null);
  const space = useUnifiedSpaceStore();
  const initialDeviceHandled = useRef<number | null>(null);

  useEffect(() => {
    void getUnifiedSpaceService()
      .refresh()
      .catch((cause) => setError(operationError(cause, t)));
  }, [t]);

  useEffect(() => {
    if (
      notificationNavigationRequestId == null ||
      initialDeviceHandled.current === notificationNavigationRequestId
    )
      return;
    if (!initialDeviceId) {
      initialDeviceHandled.current = notificationNavigationRequestId;
      deviceManagement.closeDevice();
      return;
    }
    if (!deviceManagement.devices.some((device) => device.deviceId === initialDeviceId)) return;
    initialDeviceHandled.current = notificationNavigationRequestId;
    deviceManagement.openDevice(initialDeviceId);
  }, [
    deviceManagement.closeDevice,
    deviceManagement.devices,
    deviceManagement.openDevice,
    initialDeviceId,
    notificationNavigationRequestId,
  ]);

  const handleBack = () => {
    if (pending) return;
    setError(null);
    onBack();
  };

  const leaveSpace = () => {
    if (highImpactActionsDisabled) return;
    Alert.alert(t('space.leave.action'), t('space.leave.confirm'), [
      { text: t('action.cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: t('space.leave.action'),
        style: 'destructive',
        onPress: () => {
          setPending('leave');
          setError(null);
          void getUnifiedSpaceService()
            .leaveSpace()
            .catch((cause) => setError(operationError(cause, t)))
            .finally(() => setPending(null));
        },
      },
    ]);
  };

  const spaceId = space.spaceId;
  const devices = [...deviceManagement.devices].sort(
    (left, right) => {
    const leftRank = left.isLocal ? 0 : left.reachability === 'online' ? 1 : 2;
    const rightRank = right.isLocal ? 0 : right.reachability === 'online' ? 1 : 2;
    return leftRank - rightRank;
    }
  );
  const overview = deviceManagement.overview;
  const highImpactActionsDisabled =
    !deviceManagement.highImpactActionsAvailable ||
    deviceManagement.operationInProgress ||
    deviceManagement.overview.hasPendingDecision;
  const overviewColor =
    overview.primaryStatus === 'healthy'
      ? statusGreen
      : overview.primaryStatus === 'unverifiable' ||
        overview.primaryStatus === 'decisionRequired'
      ? settingsTileColors.red
      : settingsTileColors.indigo;
  const overviewIcon =
    overview.primaryStatus === 'healthy'
      ? 'checkmark.circle.fill'
      : overview.primaryStatus === 'updateRequired'
      ? 'arrow.down.circle.fill'
      : overview.primaryStatus === 'refreshing'
      ? 'arrow.clockwise.circle.fill'
      : 'exclamationmark.circle.fill';
  const isInitialLoading =
    !spaceId && !pending && (space.status === 'idle' || space.status === 'loading');

  return (
    <IosSheetPage
        title={t('space.title')}
        leftSlots={[
          <HeaderCircleButton key="back" systemName="chevron.left" onPress={handleBack} />,
        ]}
        rightSlots={
          spaceId
            ? [
                <HeaderCircleButton
                  key="invite"
                  systemName="plus"
                  accessibilityLabel={t('space.invitation.addA11y')}
                  onPress={onOpenInvitation}
                  disabled={highImpactActionsDisabled}
                />,
              ]
            : undefined
        }
      >
        <IosSheetForm>
          {isInitialLoading ? (
            <Section>
              <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
                <ProgressView />
                <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                  {t('state.loading', { ns: 'common' })}
                </SwiftUIText>
              </HStack>
            </Section>
          ) : null}

          {!spaceId && !isInitialLoading ? (
            <Section footer={<SwiftUIText>{t('space.footer')}</SwiftUIText>}>
              <VStack spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
                <Image systemName="person.2.wave.2.fill" size={48} color={settingsTileColors.indigo} />
                <SwiftUIText modifiers={[font({ size: 22, weight: 'bold' })]}>
                  {t('space.empty.title')}
                </SwiftUIText>
                <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                  {error ?? t('space.empty.body')}
                </SwiftUIText>
                <SwiftUIButton
                  systemImage="plus.circle.fill"
                  label={t('space.create.title')}
                  onPress={() => onOpenSetup('create')}
                  modifiers={[
                    ...iosProminentButtonModifiers(
                      iosSaturatedButtonPalette(settingsTileColors.indigo),
                      { fullWidth: true }
                    ),
                    controlSize('large'),
                  ]}
                />
                <SwiftUIButton
                  systemImage="link.circle.fill"
                  label={t('space.join.title')}
                  onPress={() => onOpenSetup('join')}
                  modifiers={[buttonStyle('bordered'), controlSize('large'), frame({ maxWidth: Infinity })]}
                />
              </VStack>
            </Section>
          ) : null}

          {spaceId && error ? (
            <Section>
              <HStack spacing={8}>
                <Image systemName="exclamationmark.circle.fill" size={17} color={settingsTileColors.red} />
                <SwiftUIText modifiers={[foregroundStyle(settingsTileColors.red)]}>{error}</SwiftUIText>
              </HStack>
            </Section>
          ) : null}

          {spaceId ? (
            <>
              <Section footer={<SwiftUIText>{t('connection.p2pDescription')}</SwiftUIText>}>
                <HStack spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
                  <SettingsIconTile systemName="person.2.fill" color={settingsTileColors.indigo} />
                  <VStack alignment="leading" spacing={3}>
                    <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                      {t(`space.overview.status.${deviceManagement.overview.primaryStatus}`)}
                    </SwiftUIText>
                    <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
                      {t('space.overview.memberCount', { count: overview.memberCount })}
                    </SwiftUIText>
                  </VStack>
                  <Spacer />
                  <Image systemName={overviewIcon} size={22} color={overviewColor} />
                </HStack>
              </Section>

              <Section
                header={
                  <HStack modifiers={[frame({ maxWidth: Infinity })]}>
                    <SwiftUIText>{t('space.devices.title')}</SwiftUIText>
                    <Spacer />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {devices.length}
                    </SwiftUIText>
                  </HStack>
                }
              >
                {devices.length ? (
                  devices.map((device) => (
                    <SpaceDeviceRow
                      key={device.deviceId}
                      device={device}
                      removing={deviceManagement.removing}
                      manageHint={t('space.devices.manageHint')}
                      thisDeviceLabel={t('space.devices.thisDevice')}
                      onlineLabel={t('space.devices.online')}
                      offlineLabel={t('space.devices.offline')}
                      manageable
                      onManage={() => deviceManagement.openDevice(device.deviceId)}
                    />
                  ))
                ) : (
                  <HStack spacing={10}>
                    <Image systemName="person.2" size={18} color={settingsTileColors.gray} />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {t('space.devices.empty')}
                    </SwiftUIText>
                  </HStack>
                )}
              </Section>

              <CustomRelaySection />

              <Section footer={<SwiftUIText>{t('space.switch.description')}</SwiftUIText>}>
                <SettingsNavRow
                  icon="arrow.triangle.2.circlepath"
                  iconColor={settingsTileColors.indigo}
                  title={t('space.switch.title')}
                  accessibilityHint={t('space.switch.description')}
                  onPress={() => onOpenSetup('switch')}
                  disabled={pending !== null || highImpactActionsDisabled}
                  showsPressFeedback={false}
                />
              </Section>

              <Section footer={<SwiftUIText>{t('space.leave.confirm')}</SwiftUIText>}>
                <SettingsNavRow
                  icon="rectangle.portrait.and.arrow.right"
                  iconColor={settingsTileColors.red}
                  title={t('space.leave.action')}
                  accessibilityHint={t('space.leave.confirm')}
                  onPress={leaveSpace}
                  destructive
                  disabled={pending !== null || highImpactActionsDisabled}
                  showsChevron={false}
                  showsPressFeedback={false}
                />
              </Section>
            </>
          ) : null}
        </IosSheetForm>
    </IosSheetPage>
  );
}
