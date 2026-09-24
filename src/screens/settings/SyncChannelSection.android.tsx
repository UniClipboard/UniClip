import { memo, useState } from 'react';
import {
  Badge,
  Row,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Spacer,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth, testID, width } from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { useSettingsStore } from '@/stores';
import type { SpaceDeviceTarget } from '@/navigation/AppNavigator.types';
import { LanServersPage } from './LanServersPage';
import { useSettingsToast } from './SettingsToastContext';
import { UnifiedSpaceSetup } from './UnifiedSpaceSetup';
import { SyncChannelConfirmationSheet } from './SyncChannelConfirmationSheet';

interface SyncChannelSectionProps extends Omit<SpaceDeviceTarget, 'deviceId'> {
  /** 通知深链指定打开的空间设备(仅 P2P 通道下生效) */
  initialDeviceId?: string;
}

export const SyncChannelSection = memo(function SyncChannelSection({
  initialDeviceId,
  notificationNavigationRequestId,
}: SyncChannelSectionProps) {
  const { t } = useTranslation('settings');
  const colors = useMaterialColors();
  const showMessage = useSettingsToast();
  const syncChannel = useSettingsStore((state) => state.config?.syncChannel ?? 'lan');
  const [showP2pConfirmation, setShowP2pConfirmation] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const handleSyncChannel = async (channel: 'lan' | 'p2p') => {
    if (channel === syncChannel) return;
    const result = await useSettingsStore.getState().updateConfig({ syncChannel: channel });
    if (!result.ok) showMessage(result.error || t('hub.clipboardSync.updateFailed'), 'error');
  };

  const confirmP2pSyncChannel = async () => {
    setIsConfirming(true);
    const result = await useSettingsStore.getState().updateConfig({ syncChannel: 'p2p' });
    setIsConfirming(false);
    if (result.ok) {
      setShowP2pConfirmation(false);
    } else {
      showMessage(result.error || t('hub.clipboardSync.updateFailed'), 'error');
    }
  };

  return (
    <>
      {/* 设备页顶部的紧凑切换:设备列表才是页面主体,同步方式只占一行 */}
      <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
        <SegmentedButton
          selected={syncChannel === 'lan'}
          onClick={() => void handleSyncChannel('lan')}
          modifiers={[testID('sync-channel-lan')]}
        >
          <SegmentedButton.Label>
            <ComposeText maxLines={1}>{t('syncChannel.lanShort')}</ComposeText>
          </SegmentedButton.Label>
        </SegmentedButton>
        <SegmentedButton
          selected={syncChannel === 'p2p'}
          onClick={() => {
            if (syncChannel !== 'p2p') setShowP2pConfirmation(true);
          }}
          modifiers={[testID('sync-channel-p2p')]}
        >
          <SegmentedButton.Label>
            <Row verticalAlignment="center">
              <ComposeText maxLines={1}>{t('syncChannel.p2pShort')}</ComposeText>
              <Spacer modifiers={[width(6)]} />
              <Badge containerColor={colors.tertiaryContainer} contentColor={colors.onTertiaryContainer}>
                <ComposeText maxLines={1}>{t('syncChannel.experimentalBadge')}</ComposeText>
              </Badge>
            </Row>
          </SegmentedButton.Label>
        </SegmentedButton>
      </SingleChoiceSegmentedButtonRow>

      {syncChannel === 'lan' ? (
        <LanServersPage />
      ) : (
        <UnifiedSpaceSetup
          initialDeviceId={initialDeviceId}
          notificationNavigationRequestId={notificationNavigationRequestId}
        />
      )}
      <SyncChannelConfirmationSheet
        visible={showP2pConfirmation}
        isConfirming={isConfirming}
        onDismiss={() => setShowP2pConfirmation(false)}
        onConfirm={confirmP2pSyncChannel}
      />
    </>
  );
});
