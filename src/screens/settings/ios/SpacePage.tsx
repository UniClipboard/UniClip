import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { InvitationIssued } from 'uc-engine';
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
  accessibilityLabel,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  opacity,
  textSelection,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { IosSheetForm, IosSheetPage } from '@/components/ui';
import {
  iosProminentButtonModifiers,
  iosSaturatedButtonPalette,
} from '@/components/ui/iosButtonStyles.ios';
import { getUnifiedSpaceService, UnifiedSpaceInputError } from '@/services/UnifiedSpaceService';
import { useUnifiedEngineStore } from '@/stores/unifiedEngineStore';
import { useUnifiedSpaceStore, type UnifiedSpaceDevice } from '@/stores/unifiedSpaceStore';
import {
  HeaderCircleButton,
  SettingsIconTile,
  settingsTileColors,
  statusGreen,
} from './common';

type PendingOperation = 'invite' | 'leave' | `remove:${string}` | null;

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

function CopyableValue({
  label,
  value,
  copied,
  copyLabel,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  copyLabel: string;
  onCopy: () => void;
}) {
  return (
    <VStack alignment="leading" spacing={5} modifiers={[frame({ maxWidth: Infinity })]}>
      <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
        {label}
      </SwiftUIText>
      <HStack spacing={8} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
        <SwiftUIText
          modifiers={[
            font({ size: 13, design: 'monospaced' }),
            lineLimit(1),
            minimumScaleFactor(0.7),
            textSelection(true),
          ]}
        >
          {value}
        </SwiftUIText>
        <Spacer />
        <SwiftUIButton
          onPress={onCopy}
          modifiers={[buttonStyle('borderless'), accessibilityLabel(copyLabel)]}
        >
          <Image
            systemName={copied ? 'checkmark' : 'doc.on.doc'}
            size={16}
            color={copied ? statusGreen : settingsTileColors.gray}
            modifiers={[frame({ width: 28, height: 28 })]}
          />
        </SwiftUIButton>
      </HStack>
    </VStack>
  );
}

function SpaceDeviceRow({
  device,
  removing,
  removeLabel,
  thisDeviceLabel,
  onlineLabel,
  offlineLabel,
  onRemove,
}: {
  device: UnifiedSpaceDevice;
  removing: boolean;
  removeLabel: string;
  thisDeviceLabel: string;
  onlineLabel: string;
  offlineLabel: string;
  onRemove: () => void;
}) {
  const online = device.isLocal || device.online;
  const statusColor = online ? statusGreen : settingsTileColors.gray;

  return (
    <HStack spacing={12} alignment="center" modifiers={[frame({ maxWidth: Infinity })]}>
      <Image systemName="person.crop.circle" size={28} color={settingsTileColors.indigo} />
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
      {device.isLocal ? null : removing ? (
        <ProgressView />
      ) : (
        <SwiftUIButton
          role="destructive"
          onPress={onRemove}
          modifiers={[buttonStyle('plain'), accessibilityLabel(removeLabel)]}
        >
          <Image
            systemName="trash"
            size={16}
            color={settingsTileColors.red}
            modifiers={[frame({ width: 32, height: 32 })]}
          />
        </SwiftUIButton>
      )}
    </HStack>
  );
}

export function SpacePage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('settingsSync');
  const [setupMode, setSetupMode] = useState<AddSyncConnectionMode | null>(null);
  const [pending, setPending] = useState<PendingOperation>(null);
  const [error, setError] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<InvitationIssued | null>(null);
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const space = useUnifiedSpaceStore();
  const refreshRevision = useUnifiedEngineStore((state) => state.refreshRevision);

  useEffect(() => {
    void getUnifiedSpaceService()
      .refresh()
      .catch((cause) => setError(operationError(cause, t)));
  }, [refreshRevision, t]);

  const handleBack = () => {
    if (pending) return;
    setError(null);
    setInvitation(null);
    setCopiedValue(null);
    onBack();
  };

  const issueInvitation = async () => {
    if (pending) return;
    setPending('invite');
    setError(null);
    setCopiedValue(null);
    try {
      setInvitation(await getUnifiedSpaceService().issueInvitation());
    } catch (cause) {
      setError(operationError(cause, t));
    } finally {
      setPending(null);
    }
  };

  const copyValue = async (value: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedValue(value);
  };

  const removeMember = (deviceId: string) => {
    Alert.alert(t('space.devices.remove'), t('space.devices.removeConfirm'), [
      { text: t('action.cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: t('space.devices.remove'),
        style: 'destructive',
        onPress: () => {
          setPending(`remove:${deviceId}`);
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
          void getUnifiedSpaceService()
            .leaveSpace()
            .then(() => {
              setInvitation(null);
              setCopiedValue(null);
            })
            .catch((cause) => setError(operationError(cause, t)))
            .finally(() => setPending(null));
        },
      },
    ]);
  };

  const spaceId = space.spaceId;
  const visibleInvitation = invitation ?? space.invitation;
  const invitationDescription = visibleInvitation
    ? 'availability' in visibleInvitation
      ? t(
          visibleInvitation.availability === 'sameLocalNetwork'
            ? 'space.invitation.sameLocalNetwork'
            : 'space.invitation.crossNetwork'
        )
      : t('space.invitation.description')
    : t('space.invitation.description');
  const invitationFooter = visibleInvitation
    ? `${invitationDescription}\n${t('connection.invitationExpires', {
        time: new Date(visibleInvitation.expiresAtMs).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      })}`
    : invitationDescription;
  const isInitialLoading =
    !spaceId && !pending && (space.status === 'idle' || space.status === 'loading');

  return (
    <>
      <IosSheetPage
        title={t('space.title')}
        leftSlots={[
          <HeaderCircleButton key="back" systemName="chevron.left" onPress={handleBack} />,
        ]}
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
            <>
              <Section footer={<SwiftUIText>{t('space.footer')}</SwiftUIText>}>
                <SwiftUIButton
                  onPress={() => setSetupMode('create')}
                  modifiers={[
                    ...iosProminentButtonModifiers(
                      iosSaturatedButtonPalette(settingsTileColors.blue),
                      { fullWidth: true }
                    ),
                    controlSize('large'),
                  ]}
                >
                  <HStack spacing={8} modifiers={[frame({ minHeight: 50, maxWidth: Infinity })]}>
                    <Spacer />
                    <Image systemName="plus.circle.fill" size={17} />
                    <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                      {t('space.create.title')}
                    </SwiftUIText>
                    <Spacer />
                  </HStack>
                </SwiftUIButton>
                <SwiftUIButton
                  onPress={() => setSetupMode('join')}
                  modifiers={[buttonStyle('bordered'), controlSize('large')]}
                >
                  <HStack spacing={8} modifiers={[frame({ minHeight: 50, maxWidth: Infinity })]}>
                    <Spacer />
                    <Image systemName="link.circle.fill" size={17} />
                    <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                      {t('space.join.title')}
                    </SwiftUIText>
                    <Spacer />
                  </HStack>
                </SwiftUIButton>
              </Section>
            </>
          ) : null}

          {error ? (
            <Section>
              <HStack spacing={8}>
                <Image
                  systemName="exclamationmark.circle.fill"
                  size={17}
                  color={settingsTileColors.red}
                />
                <SwiftUIText modifiers={[foregroundStyle('red')]}>{error}</SwiftUIText>
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
                      {t('space.status.ready')}
                    </SwiftUIText>
                    {space.deviceName ? (
                      <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
                        {t('space.status.currentDevice', { name: space.deviceName })}
                      </SwiftUIText>
                    ) : null}
                  </VStack>
                  <Spacer />
                  <Image systemName="checkmark.circle.fill" size={22} color={statusGreen} />
                </HStack>
                <CopyableValue
                  label={t('space.status.spaceId')}
                  value={spaceId}
                  copied={copiedValue === spaceId}
                  copyLabel={t('action.copy', { ns: 'common' })}
                  onCopy={() => void copyValue(spaceId)}
                />
              </Section>

              <Section
                header={
                  <HStack modifiers={[frame({ maxWidth: Infinity })]}>
                    <SwiftUIText>{t('space.devices.title')}</SwiftUIText>
                    <Spacer />
                    <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
                      {space.devices.length}
                    </SwiftUIText>
                  </HStack>
                }
              >
                {space.devices.length ? (
                  space.devices.map((device) => (
                    <SpaceDeviceRow
                      key={device.deviceId}
                      device={device}
                      removing={pending === `remove:${device.deviceId}`}
                      removeLabel={t('space.devices.remove')}
                      thisDeviceLabel={t('space.devices.thisDevice')}
                      onlineLabel={t('space.devices.online')}
                      offlineLabel={t('space.devices.offline')}
                      onRemove={() => removeMember(device.deviceId)}
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

              <Section
                header={<SwiftUIText>{t('space.invitation.title')}</SwiftUIText>}
                footer={<SwiftUIText>{invitationFooter}</SwiftUIText>}
              >
                {visibleInvitation ? (
                  <CopyableValue
                    label={t('space.invitation.code')}
                    value={visibleInvitation.invitationCode}
                    copied={copiedValue === visibleInvitation.invitationCode}
                    copyLabel={t('action.copy', { ns: 'common' })}
                    onCopy={() => void copyValue(visibleInvitation.invitationCode)}
                  />
                ) : null}
                <SwiftUIButton
                  onPress={() => void issueInvitation()}
                  modifiers={[
                    buttonStyle('bordered'),
                    disabled(pending !== null),
                    opacity(pending !== null ? 0.35 : 1),
                  ]}
                >
                  <HStack spacing={7} modifiers={[frame({ maxWidth: Infinity })]}>
                    <Spacer />
                    {pending === 'invite' ? (
                      <ProgressView />
                    ) : (
                      <Image systemName="person.badge.plus" size={16} />
                    )}
                    <SwiftUIText>{t('space.invitation.action')}</SwiftUIText>
                    <Spacer />
                  </HStack>
                </SwiftUIButton>
              </Section>

              <Section footer={<SwiftUIText>{t('space.leave.confirm')}</SwiftUIText>}>
                <SwiftUIButton
                  role="destructive"
                  onPress={leaveSpace}
                  modifiers={[
                    buttonStyle('plain'),
                    disabled(pending !== null),
                    opacity(pending !== null ? 0.35 : 1),
                  ]}
                >
                  <HStack modifiers={[frame({ maxWidth: Infinity })]}>
                    <Image systemName="rectangle.portrait.and.arrow.right" size={16} />
                    <SwiftUIText>{t('space.leave.action')}</SwiftUIText>
                    <Spacer />
                  </HStack>
                </SwiftUIButton>
              </Section>
            </>
          ) : null}
        </IosSheetForm>
      </IosSheetPage>

      <AddSyncConnectionSheet
        visible={setupMode !== null}
        initialMode={setupMode ?? 'choose'}
        legacyLanEligible={false}
        embeddedInHost
        onClose={() => setSetupMode(null)}
        onOpenLegacyLan={() => {}}
        onConnected={() => {
          setSetupMode(null);
          return true;
        }}
      />
    </>
  );
}
