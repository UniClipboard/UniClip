import { useEffect, useState } from 'react';
import {
  Button,
  Column,
  Icon,
  ListItem,
  ModalBottomSheet,
  OutlinedButton,
  Spacer,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxWidth,
  height as heightModifier,
  padding,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { AppTextField, SheetPageTransition } from '@/components/ui';
import { saveCustomRelay } from '@/features/relaySettings';
import { useSettingsStore } from '@/stores';
import { SettingsSectionItem } from './SettingsSectionItem';

const ICONS = {
  add: require('../../assets/icons/add.xml'),
  chevron: require('../../assets/icons/chevron_right.xml'),
  space: require('../../assets/icons/groups.xml'),
};

const SHEET_TITLE_STYLE = { fontSize: 20, fontWeight: '600', letterSpacing: 0 } as const;
const EMPTY_RELAY_URLS: string[] = [];

export function CustomRelaySection() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const configuredUrls = useSettingsStore(
    (state) => state.config?.customRelayUrls ?? EMPTY_RELAY_URLS
  );
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRelaySettings, setShowRelaySettings] = useState(false);

  useEffect(() => {
    if (editingUrl && !configuredUrls.includes(editingUrl)) setEditingUrl(null);
  }, [configuredUrls, editingUrl]);

  const resetEditor = () => {
    setEditingUrl(null);
    setUrl('');
    setToken('');
    setError(null);
  };

  const closeRelaySettings = () => {
    setShowRelaySettings(false);
    resetEditor();
  };

  const openAddRelay = () => {
    setEditingUrl('');
    setUrl('');
    setToken('');
    setError(null);
  };

  const openEditRelay = (configuredUrl: string) => {
    setEditingUrl(configuredUrl);
    setUrl(configuredUrl);
    setToken('');
    setError(null);
  };

  const save = async (nextUrl = url) => {
    if (editingUrl === null) return;
    setPending(true);
    setError(null);
    try {
      const result = await saveCustomRelay({
        url: nextUrl,
        accessToken: token,
        currentUrls: configuredUrls,
        previousUrl: editingUrl || undefined,
      });
      const update = await updateConfig({ customRelayUrls: result.urls });
      if (!update.ok) throw new Error(update.error);
      resetEditor();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('relay.error.saveFailed'));
    } finally {
      setPending(false);
    }
  };

  const editingExistingRelay = Boolean(editingUrl);
  const canSave = Boolean(url.trim());

  return (
    <>
      <SettingsSectionItem title={t('space.advanced.title')}>
        <ListItem modifiers={[clickable(() => setShowRelaySettings(true))]}>
          <ListItem.LeadingContent>
            <Icon source={ICONS.space} size={24} tint={colors.primary} />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <ComposeText>{t('relay.title')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText color={colors.onSurfaceVariant}>
              {configuredUrls.length > 0
                ? t('relay.configuredCount', { count: configuredUrls.length })
                : t('relay.summary')}
            </ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <Icon source={ICONS.chevron} size={20} tint={colors.onSurfaceVariant} />
          </ListItem.TrailingContent>
        </ListItem>
      </SettingsSectionItem>

      {showRelaySettings ? (
        <ModalBottomSheet onDismissRequest={closeRelaySettings}>
          <Column modifiers={[fillMaxWidth(), padding(24, 8, 24, 24)]}>
            <SheetPageTransition
              showSecondPage={editingUrl !== null}
              firstPage={
                <Column modifiers={[fillMaxWidth()]}>
                  <ComposeText style={SHEET_TITLE_STYLE}>{t('relay.title')}</ComposeText>
                  <Spacer modifiers={[heightModifier(8)]} />
                  <ComposeText color={colors.onSurfaceVariant}>{t('relay.footer')}</ComposeText>
                  <Spacer modifiers={[heightModifier(20)]} />
                  {configuredUrls.length === 0 ? (
                    <ComposeText color={colors.onSurfaceVariant}>{t('relay.summary')}</ComposeText>
                  ) : (
                    configuredUrls.map((configuredUrl) => (
                      <ListItem
                        key={configuredUrl}
                        modifiers={[clickable(() => openEditRelay(configuredUrl))]}
                      >
                        <ListItem.HeadlineContent>
                          <ComposeText>{configuredUrl}</ComposeText>
                        </ListItem.HeadlineContent>
                        <ListItem.TrailingContent>
                          <Icon source={ICONS.chevron} size={20} tint={colors.onSurfaceVariant} />
                        </ListItem.TrailingContent>
                      </ListItem>
                    ))
                  )}
                  <Spacer modifiers={[heightModifier(20)]} />
                  <Button onClick={openAddRelay} modifiers={[fillMaxWidth()]}>
                    <Icon source={ICONS.add} size={18} tint={colors.onPrimary} />
                    <Spacer modifiers={[widthModifier(8)]} />
                    <ComposeText>{t('relay.add')}</ComposeText>
                  </Button>
                </Column>
              }
              secondPage={
                <Column modifiers={[fillMaxWidth()]}>
                  <ComposeText style={SHEET_TITLE_STYLE}>
                    {editingExistingRelay ? t('relay.edit') : t('relay.add')}
                  </ComposeText>
                  <Spacer modifiers={[heightModifier(8)]} />
                  <ComposeText color={colors.onSurfaceVariant}>{t('relay.footer')}</ComposeText>
                  <Spacer modifiers={[heightModifier(20)]} />
                  <ComposeText color={colors.onSurfaceVariant}>{t('relay.url')}</ComposeText>
                  <Spacer modifiers={[heightModifier(6)]} />
                  <AppTextField
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://relay.example.com"
                    keyboardType="uri"
                    fullWidth
                  />
                  <Spacer modifiers={[heightModifier(16)]} />
                  <ComposeText color={colors.onSurfaceVariant}>{t('relay.token')}</ComposeText>
                  <Spacer modifiers={[heightModifier(6)]} />
                  <AppTextField value={token} onChangeText={setToken} secure fullWidth />
                  {error ? (
                    <>
                      <Spacer modifiers={[heightModifier(12)]} />
                      <ComposeText color={colors.error}>{error}</ComposeText>
                    </>
                  ) : null}
                  <Spacer modifiers={[heightModifier(24)]} />
                  <Button
                    onClick={() => void save()}
                    enabled={!pending && canSave}
                    modifiers={[fillMaxWidth()]}
                  >
                    <ComposeText>{t('relay.save')}</ComposeText>
                  </Button>
                  {editingExistingRelay ? (
                    <>
                      <Spacer modifiers={[heightModifier(8)]} />
                      <OutlinedButton
                        onClick={() => void save('')}
                        enabled={!pending}
                        modifiers={[fillMaxWidth()]}
                      >
                        <ComposeText color={colors.error}>{t('relay.remove')}</ComposeText>
                      </OutlinedButton>
                    </>
                  ) : null}
                  <TextButton onClick={resetEditor} enabled={!pending} modifiers={[fillMaxWidth()]}>
                    <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
                  </TextButton>
                </Column>
              }
            />
          </Column>
        </ModalBottomSheet>
      ) : null}
    </>
  );
}
