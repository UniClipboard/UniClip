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
import { IosSheetForm, IosSheetPage } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSaturatedButtonPalette,
} from '@/components/ui/iosButtonStyles.ios';
import { getUnifiedSpaceService, UnifiedSpaceInputError } from '@/features/space';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore, type UnifiedSpaceDevice } from '@/features/space';
import {
  HeaderCircleButton,
  SettingsIconTile,
  SettingsNavRow,
  chevronColor,
  settingsTileColors,
  statusGreen,
} from './common';

type PendingOperation = 'leave' | `remove:${string}` | `recover:${string}` | null;

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

function SpaceDeviceRow({
  device,
  removing,
  removeLabel,
  manageHint,
  thisDeviceLabel,
  onlineLabel,
  offlineLabel,
  onManage,
}: {
  device: UnifiedSpaceDevice;
  removing: boolean;
  removeLabel: string;
  manageHint: string;
  thisDeviceLabel: string;
  onlineLabel: string;
  offlineLabel: string;
  onManage: () => void;
}) {
  const online = device.isLocal || device.online;
  const statusColor = online ? statusGreen : settingsTileColors.gray;
  const rowModifiers = [frame({ maxWidth: Infinity })];

  if (!device.isLocal && !removing) {
    rowModifiers.push(
      contentShape(shapes.rectangle()),
      onTapGesture(onManage),
      accessibilityLabel(`${device.displayName}, ${removeLabel}`),
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
            {device.isLocal ? thisDeviceLabel : online ? onlineLabel : offlineLabel}
          </SwiftUIText>
        </HStack>
      </VStack>
      <Spacer />
      {!device.isLocal ? (
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
  onBack,
  onOpenInvitation,
  onOpenSetup,
}: {
  onBack: () => void;
  onOpenInvitation: () => void;
  onOpenSetup: (mode: AddSyncConnectionMode) => void;
}) {
  const { t } = useTranslation('settingsSync');
  const [pending, setPending] = useState<PendingOperation>(null);
  const [error, setError] = useState<string | null>(null);
  const space = useUnifiedSpaceStore();
  const refreshRevision = useUnifiedEngineStore((state) => state.refreshRevision);
  const hasLoadedSpace = useRef(false);

  useEffect(() => {
    void getUnifiedSpaceService()
      .refresh()
      .catch((cause) => setError(operationError(cause, t)))
      .finally(() => {
        hasLoadedSpace.current = true;
      });
  }, [t]);

  useEffect(() => {
    if (!hasLoadedSpace.current) return;
    void getUnifiedSpaceService()
      .refreshDevices()
      .catch((cause) => setError(operationError(cause, t)));
  }, [refreshRevision, t]);

  const handleBack = () => {
    if (pending) return;
    setError(null);
    onBack();
  };

  const removeMember = (deviceId: string) => {
    Alert.alert(t('space.devices.remove'), t('space.devices.removeConfirm'), [
      { text: t('action.cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: t('space.devices.remove'),
        style: 'destructive',
        onPress: () => {
          setPending(`remove:${deviceId}`);
          setError(null);
          void getUnifiedSpaceService()
            .removeMember(deviceId)
            .catch((cause) => setError(operationError(cause, t)))
            .finally(() => setPending(null));
        },
      },
    ]);
  };

  const leaveSpace = () => {
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

  const continueMemberRemoval = (deviceId: string) => {
    const revocationId = space.memberRemoval?.revocationId;
    if (!revocationId || pending) return;

    const deviceName = space.devices.find((device) => device.deviceId === deviceId)?.displayName ?? deviceId;
    Alert.alert(
      t('space.removal.permanentLossTitle'),
      t('space.removal.permanentLossConfirm', { device: deviceName }),
      [
        { text: t('action.cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('space.removal.permanentLossAction'),
          style: 'destructive',
          onPress: () => {
            setPending(`recover:${deviceId}`);
            setError(null);
            void getUnifiedSpaceService()
              .continueMemberRevocation(revocationId, [deviceId])
              .catch((cause) => setError(operationError(cause, t)))
              .finally(() => setPending(null));
          },
        },
      ]
    );
  };

  const spaceId = space.spaceId;
  const memberRemoval = space.memberRemoval;
  const devices = [...space.devices].sort((left, right) => {
    const leftRank = left.isLocal ? 0 : left.online ? 1 : 2;
    const rightRank = right.isLocal ? 0 : right.online ? 1 : 2;
    return leftRank - rightRank;
  });
  const onlineCount = devices.filter((device) => device.isLocal || device.online).length;
  const offlineCount = devices.length - onlineCount;
  const removalDeviceName = (deviceId: string) =>
    devices.find((device) => device.deviceId === deviceId)?.displayName ?? deviceId;
  const isInitialLoading =
    !spaceId && !pending && (space.status === 'idle' || space.status === 'loading');

  return (
    <>
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
                      {t('space.overview.syncHealthy')}
                    </SwiftUIText>
                    <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
                      {t('space.overview.deviceSummary', {
                        online: onlineCount,
                        offline: offlineCount,
                      })}
                    </SwiftUIText>
                  </VStack>
                  <Spacer />
                  <Image systemName="checkmark.circle.fill" size={22} color={statusGreen} />
                </HStack>
              </Section>

              {memberRemoval ? (
                <Section
                  header={<SwiftUIText>{t('space.removal.title')}</SwiftUIText>}
                  footer={
                    <SwiftUIText>
                      {memberRemoval.outcome === 'complete' || memberRemoval.outcome === 'localOnly'
                        ? t('space.removal.complete')
                        : memberRemoval.outcome === 'recoveryRequired'
                        ? t('space.removal.recoveryRequired')
                        : t('space.removal.waiting')}
                    </SwiftUIText>
                  }
                >
                  {memberRemoval.pendingRecipientDeviceIds.map((deviceId) => (
                    <HStack key={deviceId} spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
                      <Image systemName="desktopcomputer" size={17} color={settingsTileColors.indigo} />
                      <VStack alignment="leading" spacing={2}>
                        <SwiftUIText>{removalDeviceName(deviceId)}</SwiftUIText>
                        <SwiftUIText
                          modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}
                        >
                          {t('space.removal.pendingDevice')}
                        </SwiftUIText>
                      </VStack>
                      <Spacer />
                      {memberRemoval.outcome === 'recoveryRequired' ? (
                        pending === `recover:${deviceId}` ? (
                          <ProgressView />
                        ) : (
                          <SwiftUIButton
                            role="destructive"
                            label={t('space.removal.permanentLossAction')}
                            onPress={() => continueMemberRemoval(deviceId)}
                            modifiers={[buttonStyle('bordered'), controlSize('small')]}
                          />
                        )
                      ) : null}
                    </HStack>
                  ))}
                </Section>
              ) : null}

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
                      removing={pending === `remove:${device.deviceId}`}
                      removeLabel={t('space.devices.remove')}
                      manageHint={t('space.devices.manageHint')}
                      thisDeviceLabel={t('space.devices.thisDevice')}
                      onlineLabel={t('space.devices.online')}
                      offlineLabel={t('space.devices.offline')}
                      onManage={() => removeMember(device.deviceId)}
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

              <Section footer={<SwiftUIText>{t('space.switch.description')}</SwiftUIText>}>
                <SettingsNavRow
                  icon="arrow.triangle.2.circlepath"
                  iconColor={settingsTileColors.indigo}
                  title={t('space.switch.title')}
                  accessibilityHint={t('space.switch.description')}
                  onPress={() => onOpenSetup('switch')}
                  disabled={pending !== null}
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
                  disabled={pending !== null}
                  showsChevron={false}
                  showsPressFeedback={false}
                />
              </Section>
            </>
          ) : null}
        </IosSheetForm>
      </IosSheetPage>

    </>
  );
}
