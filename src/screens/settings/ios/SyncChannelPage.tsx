import { Section } from '@expo/ui/swift-ui';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import type { AddSyncConnectionMode } from '@/components/AddSyncConnectionSheet.types';
import type { SpaceDeviceManagementController } from '@/components/useSpaceDeviceManagement';
import { useSettingsStore } from '@/stores';
import { HeaderCircleButton, SettingsNavRow } from './common';
import { LanServersPage } from './LanServersPage';
import { SpacePage } from './SpacePage';

export function SyncChannelPage({
  onBack,
  onAddLanServer,
  onEditLanServer,
  onOpenInvitation,
  onOpenSetup,
  onRequestP2pConfirmation,
  deviceManagement,
}: {
  onBack(): void;
  onAddLanServer(): void;
  onEditLanServer(serverId: string): void;
  onOpenInvitation(): void;
  onOpenSetup(mode: AddSyncConnectionMode): void;
  onRequestP2pConfirmation(): void;
  deviceManagement: SpaceDeviceManagementController;
}) {
  const { t } = useTranslation('settings');
  const syncChannel = useSettingsStore((state) => state.config?.syncChannel ?? 'lan');

  const handleSyncChannel = async (channel: 'lan') => {
    if (channel === syncChannel) return;
    await useSettingsStore.getState().updateConfig({ syncChannel: channel });
  };

  return (
    <IosSheetPage
      title={t('syncChannel.title')}
      spacing={0}
      leftSlots={[<HeaderCircleButton key="back" systemName="chevron.left" onPress={onBack} />]}
    >
      <IosSheetForm>
        <Section>
          <SettingsNavRow
            title={t('syncChannel.lan')}
            selected={syncChannel === 'lan'}
            showsChevron={false}
            showsPressFeedback={false}
            onPress={() => void handleSyncChannel('lan')}
          />
          <SettingsNavRow
            title={t('syncChannel.p2p')}
            badge={t('syncChannel.experimental')}
            selected={syncChannel === 'p2p'}
            showsChevron={false}
            showsPressFeedback={false}
            onPress={onRequestP2pConfirmation}
          />
        </Section>

        {syncChannel === 'lan' ? (
          <LanServersPage
            embedded
            onBack={onBack}
            onAdd={onAddLanServer}
            onEdit={onEditLanServer}
          />
        ) : (
          <SpacePage
            embedded
            onBack={onBack}
            onOpenInvitation={onOpenInvitation}
            onOpenSetup={onOpenSetup}
            deviceManagement={deviceManagement}
          />
        )}
      </IosSheetForm>
    </IosSheetPage>
  );
}
