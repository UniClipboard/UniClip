import {
  Button as SwiftUIButton,
  HStack,
  Image,
  Picker,
  ProgressView,
  Section,
  Spacer,
  Text as SwiftUIText,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  background,
  buttonBorderShape,
  buttonStyle,
  contentShape,
  controlSize,
  cornerRadius,
  disabled,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  multilineTextAlignment,
  padding,
  pickerStyle,
  shapes,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import { PlatformColor } from 'react-native';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import type { SpaceDeviceManagementController } from '@/components/useSpaceDeviceManagement';
import { useSpacePageRefresh } from '@/components/useSpacePageRefresh';
import {
  UnifiedSpaceInputError,
  useUnifiedSpaceStore,
  spaceMaintenanceMessage,
} from '@/features/space';
import { useSettingsStore } from '@/stores';
import { iosColors } from '@/theme/iosDesignTokens';
import {
  chevronColor,
  settingsTileColors,
  statusGreen,
} from '@/screens/settings/ios/common';
import { DeviceIconTile, SpaceDeviceRow } from './deviceRows';

function operationError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnifiedSpaceInputError) return t(`space.error.${error.code}`);
  return t('space.error.operationFailed');
}

/** 行内胶囊按钮(状态卡、空状态) */
const capsuleButton = (prominent: boolean, size: 'regular' | 'large' = 'regular') => [
  buttonStyle(prominent ? 'borderedProminent' : 'bordered'),
  buttonBorderShape('capsule'),
  controlSize(size),
];

export interface DevicesRootPageProps {
  deviceManagement: SpaceDeviceManagementController;
  onOpenSetup: (mode: AddSyncConnectionMode) => void;
  onOpenSpaceSettings: () => void;
  onRequestP2pConfirmation: () => void;
  onAddLanServer: () => void;
  onEditLanServer: (serverId: string) => void;
  /** 同步方式切换被拒绝(待确认)时递增,让分段控件回到当前值 */
  syncChannelPickerKey: number;
}

/**
 * iOS「设备」标签页根页:顶部是同步方式分段控件,下面按通道展示:
 * - 常规(局域网):服务器列表 + 添加服务器;
 * - 直连:状态卡(整体状态 + 添加设备)→ 本机 → 其他设备 → 「空间设置」入口;未加入空间时为
 *   居中的空状态。
 * 所有 sheet 由 DevicesScreen 这个稳定宿主持有,本页只上报动作。
 */
export function DevicesRootPage({
  deviceManagement,
  onOpenSetup,
  onOpenSpaceSettings,
  onRequestP2pConfirmation,
  onAddLanServer,
  onEditLanServer,
  syncChannelPickerKey,
}: DevicesRootPageProps) {
  const { t } = useTranslation('settingsSync');
  const syncChannel = useSettingsStore((state) => state.config?.syncChannel ?? 'lan');
  const spaceId = useUnifiedSpaceStore((state) => state.spaceId);
  const pageRefresh = useSpacePageRefresh();

  const onSelectChannel = (value: string) => {
    if (value === syncChannel) return;
    if (value === 'p2p') {
      onRequestP2pConfirmation();
      return;
    }
    void useSettingsStore.getState().updateConfig({ syncChannel: 'lan' });
  };

  const refreshButton =
    syncChannel === 'p2p' && spaceId ? (
      <SwiftUIButton
        key="refresh"
        testID="space-refresh"
        systemImage="arrow.clockwise"
        label={t('action.refresh', { ns: 'common' })}
        onPress={() => void pageRefresh.refresh()}
      />
    ) : null;

  return (
    <IosSheetPage
      title={t('nav.devices', { ns: 'home' })}
      rightSlots={refreshButton ? [refreshButton] : undefined}
    >
      <IosSheetForm>
        <Section>
          <Picker
            key={syncChannelPickerKey}
            testID="sync-channel-picker"
            selection={syncChannel}
            onSelectionChange={(value) => onSelectChannel(String(value))}
            modifiers={[pickerStyle('segmented'), listRowBackground('clear')]}
          >
            <SwiftUIText modifiers={[tag('lan')]}>{t('syncChannel.lanShort', { ns: 'settings' })}</SwiftUIText>
            <SwiftUIText modifiers={[tag('p2p')]}>
              {`${t('syncChannel.p2pShort', { ns: 'settings' })} (${t('syncChannel.experimentalBadge', { ns: 'settings' })})`}
            </SwiftUIText>
          </Picker>
        </Section>

        {syncChannel === 'lan' ? (
          <LanServersContent onAdd={onAddLanServer} onEdit={onEditLanServer} />
        ) : (
          <DirectSpaceContent
            deviceManagement={deviceManagement}
            pageRefresh={pageRefresh}
            onOpenSetup={onOpenSetup}
            onOpenSpaceSettings={onOpenSpaceSettings}
          />
        )}
      </IosSheetForm>
    </IosSheetPage>
  );
}

function LanServersContent({ onAdd, onEdit }: { onAdd: () => void; onEdit: (id: string) => void }) {
  const { t } = useTranslation('settingsSync');
  const servers = useSettingsStore((state) => state.config?.lanServers ?? []);
  return (
    <Section
      header={
        <SwiftUIText>
          {servers.length ? `${t('lan.title')} · ${servers.length}` : t('lan.title')}
        </SwiftUIText>
      }
      footer={<SwiftUIText>{t('lan.notAvailableYet')}</SwiftUIText>}
    >
      {servers.map((server) => (
        <SwiftUIButton
          key={server.id}
          onPress={() => onEdit(server.id)}
          modifiers={[buttonStyle('plain'), accessibilityLabel(server.name || server.urls[0])]}
        >
          <HStack
            spacing={16}
            alignment="center"
            modifiers={[frame({ maxWidth: Infinity, minHeight: 48 }), contentShape(shapes.rectangle())]}
          >
            <DeviceIconTile systemName="server.rack" />
            <VStack alignment="leading" spacing={1}>
              <SwiftUIText>{server.name || server.urls[0]}</SwiftUIText>
              {server.name ? (
                <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
                  {server.urls[0]}
                </SwiftUIText>
              ) : null}
            </VStack>
            <Spacer />
            <Image systemName="chevron.right" size={13} color={chevronColor} />
          </HStack>
        </SwiftUIButton>
      ))}
      <SwiftUIButton testID="lan-add-server" onPress={onAdd} modifiers={[buttonStyle('plain')]}>
        <HStack
          spacing={16}
          alignment="center"
          modifiers={[frame({ maxWidth: Infinity, minHeight: 44 }), contentShape(shapes.rectangle())]}
        >
          <Image
            systemName="plus"
            size={17}
            color={iosColors?.label}
            modifiers={[frame({ width: 36, height: 36 })]}
          />
          <SwiftUIText>{t('lan.add')}</SwiftUIText>
          <Spacer />
        </HStack>
      </SwiftUIButton>
    </Section>
  );
}

function DirectSpaceContent({
  deviceManagement,
  pageRefresh,
  onOpenSetup,
  onOpenSpaceSettings,
}: {
  deviceManagement: SpaceDeviceManagementController;
  pageRefresh: ReturnType<typeof useSpacePageRefresh>;
  onOpenSetup: (mode: AddSyncConnectionMode) => void;
  onOpenSpaceSettings: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const space = useUnifiedSpaceStore();
  const spaceId = space.spaceId;
  const refreshError = pageRefresh.error ? operationError(pageRefresh.error, t) : null;
  const isInitialLoading =
    !spaceId &&
    !refreshError &&
    (pageRefresh.waiting || space.status === 'idle' || space.status === 'loading');

  if (isInitialLoading) {
    return (
      <Section>
        <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
          <ProgressView />
          <SwiftUIText modifiers={[foregroundStyle('secondary')]}>
            {t('state.loading', { ns: 'common' })}
          </SwiftUIText>
        </HStack>
      </Section>
    );
  }

  if (!spaceId) {
    return (
      <Section modifiers={[listRowBackground('clear')]}>
        <VStack
          spacing={10}
          alignment="center"
          modifiers={[frame({ maxWidth: Infinity }), padding({ top: 36, bottom: 8 })]}
        >
          <Image
            systemName="laptopcomputer.and.iphone"
            size={38}
            color={iosColors?.label}
            modifiers={[
              frame({ width: 88, height: 88 }),
              background(PlatformColor('tertiarySystemFill')),
              cornerRadius(44),
            ]}
          />
          <SwiftUIText
            modifiers={[font({ size: 22, weight: 'bold' }), padding({ top: 10 }), multilineTextAlignment('center')]}
          >
            {t('space.empty.title')}
          </SwiftUIText>
          <SwiftUIText modifiers={[foregroundStyle('secondary'), multilineTextAlignment('center')]}>
            {refreshError ?? t('space.empty.body')}
          </SwiftUIText>
          {refreshError ? (
            <SwiftUIButton
              label={t('action.retry', { ns: 'common' })}
              onPress={() => void pageRefresh.refresh()}
              modifiers={[buttonStyle('borderless')]}
            />
          ) : null}
          <VStack spacing={10} modifiers={[frame({ maxWidth: Infinity }), padding({ top: 16 })]}>
            <SwiftUIButton
              testID="space-create"
              onPress={() => onOpenSetup('create')}
              modifiers={capsuleButton(true, 'large')}
            >
              <HStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
                <Spacer />
                <Image systemName="plus" size={17} />
                <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>{t('space.create.title')}</SwiftUIText>
                <Spacer />
              </HStack>
            </SwiftUIButton>
            <SwiftUIButton
              testID="space-join"
              onPress={() => onOpenSetup('join')}
              modifiers={capsuleButton(false, 'large')}
            >
              <HStack modifiers={[frame({ maxWidth: Infinity })]}>
                <Spacer />
                <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>{t('space.join.title')}</SwiftUIText>
                <Spacer />
              </HStack>
            </SwiftUIButton>
          </VStack>
          <SwiftUIText
            modifiers={[
              font({ size: 13 }),
              foregroundStyle('secondary'),
              multilineTextAlignment('center'),
              padding({ top: 8 }),
            ]}
          >
            {t('space.footer')}
          </SwiftUIText>
        </VStack>
      </Section>
    );
  }

  const overview = deviceManagement.overview;
  const devices = [...deviceManagement.devices].sort((left, right) => {
    const rank = (d: typeof left) => (d.isLocal ? 0 : d.reachability === 'online' ? 1 : 2);
    return rank(left) - rank(right);
  });
  const localDevice = devices.find((device) => device.isLocal) ?? null;
  const otherDevices = devices.filter((device) => !device.isLocal);
  const deviceUpdateInProgress =
    space.deviceTrustQuery?.kind === 'ready' &&
    space.deviceTrustQuery.snapshot.currentJoin?.type === 'active' &&
    space.deviceTrustQuery.snapshot.spaceDeviceUpdate.phase !== 'completed';
  const highImpactActionsDisabled =
    !deviceManagement.highImpactActionsAvailable ||
    deviceManagement.operationInProgress ||
    overview.hasPendingDecision;
  const syncFailed =
    overview.primaryStatus === 'unverifiable' || overview.primaryStatus === 'decisionRequired';
  const healthy = overview.primaryStatus === 'healthy';
  const badgeColor = syncFailed
    ? settingsTileColors.orange
    : healthy
      ? statusGreen
      : settingsTileColors.blue;
  const overviewBody =
    refreshError ??
    spaceMaintenanceMessage(overview, t) ??
    t('space.overview.memberCount', { count: overview.memberCount });

  const statusHeader = (
    <HStack spacing={14} alignment="top" modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
      {overview.isRefreshing ? (
        <ProgressView modifiers={[frame({ width: 44, height: 44 })]} />
      ) : (
        <Image
          systemName={healthy ? 'checkmark' : 'exclamationmark'}
          size={20}
          color="white"
          modifiers={[frame({ width: 44, height: 44 }), background(badgeColor), cornerRadius(22)]}
        />
      )}
      <VStack alignment="leading" spacing={3}>
        <SwiftUIText modifiers={[font({ size: 17, weight: 'semibold' })]}>
          {t(`space.overview.status.${overview.primaryStatus}`)}
        </SwiftUIText>
        <SwiftUIText modifiers={[font({ size: 15 }), foregroundStyle('secondary')]}>
          {overviewBody}
        </SwiftUIText>
      </VStack>
      <Spacer />
      {deviceUpdateInProgress ? (
        <Image systemName="chevron.right" size={13} color={chevronColor} />
      ) : null}
    </HStack>
  );

  return (
    <>
      <Section>
        <VStack spacing={14} alignment="leading" modifiers={[padding({ vertical: 6 })]}>
          {deviceUpdateInProgress ? (
            <SwiftUIButton onPress={() => onOpenSetup('join')} modifiers={[buttonStyle('plain')]}>
              {statusHeader}
            </SwiftUIButton>
          ) : (
            statusHeader
          )}
          <HStack spacing={10} modifiers={[padding({ leading: 58 })]}>
            <SwiftUIButton
              testID="space-add-device"
              onPress={() => onOpenSetup('invite')}
              modifiers={[...capsuleButton(false), disabled(highImpactActionsDisabled)]}
            >
              <HStack spacing={6}>
                <Image systemName="plus" size={15} />
                <SwiftUIText modifiers={[font({ weight: 'semibold' })]}>
                  {t('space.invitation.addAction')}
                </SwiftUIText>
              </HStack>
            </SwiftUIButton>
            {syncFailed && !overview.isRefreshing ? (
              <SwiftUIButton
                label={t('action.retry', { ns: 'common' })}
                onPress={() => void pageRefresh.refresh()}
                modifiers={capsuleButton(false)}
              />
            ) : null}
          </HStack>
        </VStack>
      </Section>

      <Section header={<SwiftUIText>{t('space.devices.thisDevice')}</SwiftUIText>}>
        {localDevice ? (
          <SpaceDeviceRow
            device={localDevice}
            removing={false}
            onManage={() => deviceManagement.openDevice(localDevice.deviceId)}
          />
        ) : (
          <HStack spacing={16} modifiers={[frame({ maxWidth: Infinity, minHeight: 48 })]}>
            <DeviceIconTile systemName="iphone" />
            <SwiftUIText>{space.deviceName ?? t('space.devices.thisDevice')}</SwiftUIText>
            <Spacer />
          </HStack>
        )}
      </Section>

      <Section
        header={<SwiftUIText>{`${t('space.devices.otherTitle')} · ${otherDevices.length}`}</SwiftUIText>}
      >
        {otherDevices.length ? (
          otherDevices.map((device) => (
            <SpaceDeviceRow
              key={device.deviceId}
              device={device}
              removing={deviceManagement.removing}
              onManage={() => deviceManagement.openDevice(device.deviceId)}
            />
          ))
        ) : (
          <HStack spacing={16} modifiers={[frame({ maxWidth: Infinity, minHeight: 48 })]}>
            <DeviceIconTile systemName="laptopcomputer" />
            <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{t('space.devices.empty')}</SwiftUIText>
            <Spacer />
          </HStack>
        )}
      </Section>

      <Section>
        <SwiftUIButton
          testID="space-settings"
          onPress={onOpenSpaceSettings}
          modifiers={[buttonStyle('plain')]}
        >
          <HStack
            spacing={16}
            alignment="center"
            modifiers={[frame({ maxWidth: Infinity, minHeight: 48 }), contentShape(shapes.rectangle())]}
          >
            <Image
              systemName="gearshape.fill"
              size={16}
              color="white"
              modifiers={[frame({ width: 30, height: 30 }), background(settingsTileColors.gray), cornerRadius(7)]}
            />
            <VStack alignment="leading" spacing={1}>
              <SwiftUIText>{t('space.settings.title')}</SwiftUIText>
              <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
                {t('space.settings.summary')}
              </SwiftUIText>
            </VStack>
            <Spacer />
            <Image systemName="chevron.right" size={13} color={chevronColor} />
          </HStack>
        </SwiftUIButton>
      </Section>
    </>
  );
}
