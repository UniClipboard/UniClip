import { useEffect, useState } from 'react';
import { Icon, ListItem, Text as ComposeText, useMaterialColors } from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { LanServerEditorSheet } from '@/components/LanServerEditorSheet';
import {
  usePendingLanConnectStore,
  type LanConnectIntent,
  type LanServerProfile,
} from '@/features/lan-servers';
import { useSettingsStore } from '@/features/settings';
import { SettingsSectionItem, useSettingsSectionRowColors } from './SettingsSectionItem';
import { SettingsLeadingIcon } from './android/SettingsLeadingIcon';

const ICONS = {
  add: require('../../assets/icons/add.xml'),
  chevron: require('../../assets/icons/chevron_right.xml'),
  server: require('../../assets/icons/dns.xml'),
};

export function LanServersPage() {
  const { t } = useTranslation('settingsSync');
  const servers = useSettingsStore((state) => state.config?.lanServers ?? []);
  const pendingIntent = usePendingLanConnectStore((state) => state.intent);
  const consumePendingIntent = usePendingLanConnectStore((state) => state.consume);
  const [editingServerId, setEditingServerId] = useState<string | 'new' | null>(null);
  const [initialIntent, setInitialIntent] = useState<LanConnectIntent | null>(null);

  useEffect(() => {
    if (!pendingIntent) return;
    const intent = consumePendingIntent();
    if (!intent) return;
    setInitialIntent(intent);
    setEditingServerId('new');
  }, [consumePendingIntent, pendingIntent]);

  const closeEditor = () => {
    setEditingServerId(null);
    setInitialIntent(null);
  };

  return (
    <>
      <SettingsSectionItem
        variant="grouped"
        title={servers.length ? `${t('lan.title')} · ${servers.length}` : t('lan.title')}
        footer={t('lan.notAvailableYet')}
      >
        {servers.map((server) => (
          <LanServerRow key={server.id} server={server} onEdit={() => setEditingServerId(server.id)} />
        ))}
        <AddServerRow key="add" label={t('lan.add')} onAdd={() => setEditingServerId('new')} />
      </SettingsSectionItem>
      <LanServerEditorSheet
        visible={editingServerId !== null}
        serverId={editingServerId && editingServerId !== 'new' ? editingServerId : null}
        initialIntent={initialIntent}
        onClose={closeEditor}
      />
    </>
  );
}

function LanServerRow({ server, onEdit }: { server: LanServerProfile; onEdit: () => void }) {
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  return (
    <ListItem colors={rowColors} modifiers={[clickable(onEdit)]}>
      <ListItem.LeadingContent>
        <SettingsLeadingIcon source={ICONS.server} />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText>{server.name || server.urls[0]}</ComposeText>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <ComposeText color={colors.onSurfaceVariant}>{server.urls[0]}</ComposeText>
      </ListItem.SupportingContent>
      <ListItem.TrailingContent>
        <Icon source={ICONS.chevron} size={20} tint={colors.onSurfaceVariant} />
      </ListItem.TrailingContent>
    </ListItem>
  );
}

function AddServerRow({ label, onAdd }: { label: string; onAdd: () => void }) {
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  return (
    <ListItem colors={rowColors} modifiers={[clickable(onAdd)]}>
      <ListItem.LeadingContent>
        <SettingsLeadingIcon source={ICONS.add} tone="accent" />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText color={colors.primary}>{label}</ComposeText>
      </ListItem.HeadlineContent>
    </ListItem>
  );
}
