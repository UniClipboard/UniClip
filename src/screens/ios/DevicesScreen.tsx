import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { Host, NavigationDestination, NavigationStack, ZStack } from '@expo/ui/swift-ui';
import { frame, tint } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { AddSyncConnectionSheet } from '@/components/AddSyncConnectionSheet';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import { SpaceDeviceDetail } from '@/components/SpaceDeviceDetail';
import { IosPageChromeProvider, type IosPageChrome } from '@/components/ui';
import { useSpaceDeviceManagement } from '@/components/useSpaceDeviceManagement';
import { usePendingLanConnectStore, type LanConnectIntent } from '@/features/lan-servers';
import type { SpaceDeviceTarget } from '@/navigation/AppNavigator.types';
import { useHideTabBarOnSubPage } from '@/navigation/ios/useHideTabBarOnSubPage';
import { useSettingsStore } from '@/stores';
import { iosAccentColor } from '@/theme/iosDesignTokens';
import { LanServerEditorSheet } from '@/screens/settings/ios/LanServerEditorSheet';
import { SyncChannelConfirmationSheet } from '@/screens/settings/SyncChannelConfirmationSheet';
import { DevicesRootPage } from './devices/DevicesRootPage';
import { SpaceSettingsPage } from './devices/SpaceSettingsPage';

const fillModifier = frame({ maxWidth: Infinity, maxHeight: Infinity });
const NAVIGATION_CHROME: IosPageChrome = { kind: 'navigation' };

/**
 * iOS「设备」标签页。一个全屏 Host 内是 SwiftUI NavigationStack(根页:同步方式 + 设备 /
 * 服务器;推入:空间设置),所有 sheet 作为导航栈的兄弟节点由本页这个稳定宿主持有,
 * 推入 / 返回动画不会让 sheet 所在的视图消失。
 */
export function DevicesScreen({ deviceId, notificationNavigationRequestId }: SpaceDeviceTarget) {
  const { t } = useTranslation('settings');
  const [path, setPath] = useState<string[]>([]);
  useHideTabBarOnSubPage(path);
  const [setupMode, setSetupMode] = useState<AddSyncConnectionMode | null>(null);
  const [editingLanServerId, setEditingLanServerId] = useState<string | 'new' | null>(null);
  const [lanServerIntent, setLanServerIntent] = useState<LanConnectIntent | null>(null);
  const [showP2pConfirmation, setShowP2pConfirmation] = useState(false);
  const [isConfirmingP2p, setIsConfirmingP2p] = useState(false);
  const deviceManagement = useSpaceDeviceManagement({ allowHighImpactActions: true });
  const pendingLanIntent = usePendingLanConnectStore((state) => state.intent);
  const consumePendingLanIntent = usePendingLanConnectStore((state) => state.consume);
  const notificationHandled = useRef<number | null>(null);

  // 局域网连接深链:回到根页并直接打开「添加服务器」
  useEffect(() => {
    if (!pendingLanIntent) return;
    const intent = consumePendingLanIntent();
    if (!intent) return;
    setPath([]);
    setLanServerIntent(intent);
    setEditingLanServerId('new');
  }, [consumePendingLanIntent, pendingLanIntent]);

  // 设备关系通知:打开指定设备(设备列表加载后),或只回到设备页
  useEffect(() => {
    if (
      notificationNavigationRequestId == null ||
      notificationHandled.current === notificationNavigationRequestId
    )
      return;
    if (!deviceId) {
      notificationHandled.current = notificationNavigationRequestId;
      setPath([]);
      deviceManagement.closeDevice();
      return;
    }
    if (!deviceManagement.devices.some((device) => device.deviceId === deviceId)) return;
    notificationHandled.current = notificationNavigationRequestId;
    setPath([]);
    deviceManagement.openDevice(deviceId);
  }, [
    deviceId,
    deviceManagement.closeDevice,
    deviceManagement.devices,
    deviceManagement.openDevice,
    notificationNavigationRequestId,
  ]);

  const requestP2pConfirmation = useCallback(() => {
    setShowP2pConfirmation(true);
  }, []);

  const confirmP2pSyncChannel = useCallback(async () => {
    setIsConfirmingP2p(true);
    const result = await useSettingsStore.getState().updateConfig({ syncChannel: 'p2p' });
    setIsConfirmingP2p(false);
    if (result.ok) {
      setShowP2pConfirmation(false);
    } else {
      Alert.alert(t('syncChannel.title'), t('syncChannel.updateFailed'));
    }
  }, [t]);

  const closeLanEditor = useCallback(() => {
    setEditingLanServerId(null);
    setLanServerIntent(null);
  }, []);

  return (
    <Host style={styles.host}>
      <ZStack modifiers={[fillModifier, ...(iosAccentColor ? [tint(iosAccentColor)] : [])]}>
        <IosPageChromeProvider value={NAVIGATION_CHROME}>
          <NavigationStack path={path} onPathChange={setPath}>
            <DevicesRootPage
              deviceManagement={deviceManagement}
              onOpenSetup={setSetupMode}
              onOpenSpaceSettings={() => setPath(['spaceSettings'])}
              onRequestP2pConfirmation={requestP2pConfirmation}
              onAddLanServer={() => {
                setLanServerIntent(null);
                setEditingLanServerId('new');
              }}
              onEditLanServer={(serverId) => {
                setLanServerIntent(null);
                setEditingLanServerId(serverId);
              }}
              p2pConfirmationPending={showP2pConfirmation}
            />
            <NavigationDestination value="spaceSettings">
              <SpaceSettingsPage
                deviceManagement={deviceManagement}
                onSwitchSpace={() => setSetupMode('switch')}
                onLeft={() => setPath([])}
              />
            </NavigationDestination>
          </NavigationStack>
        </IosPageChromeProvider>

        <SpaceDeviceDetail
          device={deviceManagement.selectedDevice}
          canRemove={deviceManagement.canRemoveSelected}
          confirmingRemoval={deviceManagement.confirmingRemoval}
          removing={deviceManagement.removing}
          removeErrorMessage={
            deviceManagement.removeError ? t('space.error.operationFailed', { ns: 'settingsSync' }) : null
          }
          onClose={deviceManagement.closeDevice}
          onRequestRemove={deviceManagement.requestRemove}
          onCancelRemove={deviceManagement.cancelRemove}
          onConfirmRemove={() => void deviceManagement.confirmRemove()}
        />
        <AddSyncConnectionSheet
          visible={setupMode !== null}
          initialMode={setupMode ?? 'choose'}
          embeddedInHost
          persistentPresentation
          onClose={() => setSetupMode(null)}
          onConnected={() => {
            setSetupMode(null);
            return true;
          }}
        />
        <LanServerEditorSheet
          visible={editingLanServerId !== null}
          serverId={editingLanServerId && editingLanServerId !== 'new' ? editingLanServerId : null}
          initialIntent={lanServerIntent}
          onClose={closeLanEditor}
        />
        <SyncChannelConfirmationSheet
          visible={showP2pConfirmation}
          isConfirming={isConfirmingP2p}
          onDismiss={() => setShowP2pConfirmation(false)}
          onConfirm={confirmP2pSyncChannel}
        />
      </ZStack>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
});
