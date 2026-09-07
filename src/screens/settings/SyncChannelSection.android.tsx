import { memo } from 'react';
import {
  Badge,
  HorizontalDivider,
  ListItem,
  RadioButton,
  Row,
  Spacer,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import { width } from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { useSettingsStore } from '@/stores';
import { LanServersPage } from './LanServersPage';
import { SettingsSectionItem } from './SettingsSectionItem';
import { useSettingsToast } from './SettingsToastContext';
import { UnifiedSpaceSetup } from './UnifiedSpaceSetup';

export const SyncChannelSection = memo(function SyncChannelSection() {
  const { t } = useTranslation('settings');
  const showMessage = useSettingsToast();
  const syncChannel = useSettingsStore((state) => state.config?.syncChannel ?? 'lan');

  const handleSyncChannel = async (channel: 'lan' | 'p2p') => {
    if (channel === syncChannel) return;
    const result = await useSettingsStore.getState().updateConfig({ syncChannel: channel });
    if (!result.ok) showMessage(result.error || t('hub.clipboardSync.updateFailed'), 'error');
  };

  return (
    <>
      <SettingsSectionItem title={t('syncChannel.title')}>
        <ListItem modifiers={[clickable(() => void handleSyncChannel('lan'))]}>
          <ListItem.HeadlineContent>
            <ComposeText>{t('syncChannel.lan')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.TrailingContent>
            <RadioButton selected={syncChannel === 'lan'} />
          </ListItem.TrailingContent>
        </ListItem>
        <HorizontalDivider />
        <ListItem modifiers={[clickable(() => void handleSyncChannel('p2p'))]}>
          <ListItem.HeadlineContent>
            <Row verticalAlignment="center">
              <ComposeText>{t('syncChannel.p2p')}</ComposeText>
              <Spacer modifiers={[width(8)]} />
              <Badge containerColor="#FF9500" contentColor="white">
                <ComposeText>{t('syncChannel.experimental')}</ComposeText>
              </Badge>
            </Row>
          </ListItem.HeadlineContent>
          <ListItem.TrailingContent>
            <RadioButton selected={syncChannel === 'p2p'} />
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>

      {syncChannel === 'lan' ? <LanServersPage /> : <UnifiedSpaceSetup />}
    </>
  );
});
