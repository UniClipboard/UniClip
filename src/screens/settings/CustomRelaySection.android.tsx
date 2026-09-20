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
  testID,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { AppTextField, SheetPageTransition } from '@/components/ui';
import type { RelayMutationRejection } from '@/features/relaySettings';
import { SettingsSectionItem } from './SettingsSectionItem';
import { useCustomRelaySettings } from './useCustomRelaySettings';

const ICONS = {
  add: require('../../assets/icons/add.xml'),
  chevron: require('../../assets/icons/chevron_right.xml'),
  space: require('../../assets/icons/groups.xml'),
};

const SHEET_TITLE_STYLE = { fontSize: 20, fontWeight: '600', letterSpacing: 0 } as const;
const rejectionKey: Record<RelayMutationRejection, string> = {
  invalidUrl: 'relay.error.invalidUrl',
  duplicate: 'relay.error.duplicate',
  notFound: 'relay.error.notFound',
};

export function CustomRelaySection() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const { relays, refresh, save: saveRelay, initialRefreshFailed } = useCustomRelaySettings();
  const configuredUrls = relays.map(({ url: relayUrl }) => relayUrl);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRelaySettings, setShowRelaySettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (initialRefreshFailed) setNotice(t('relay.error.refreshFailed'));
  }, [initialRefreshFailed, t]);

  useEffect(() => {
    if (editingUrl && !configuredUrls.includes(editingUrl)) setEditingUrl(null);
  }, [configuredUrls, editingUrl]);

  const resetEditor = () => {
    setEditingUrl(null);
    setUrl('');
    setToken('');
    setError(null);
    setNotice(null);
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
    setNotice(null);
  };

  const openEditRelay = (configuredUrl: string) => {
    setEditingUrl(configuredUrl);
    setUrl(configuredUrl);
    setToken('');
    setError(null);
    setNotice(null);
  };

  const save = async (nextUrl = url) => {
    if (editingUrl === null) return;
    setPending(true);
    setError(null);
    try {
      const result = await saveRelay({
        url: nextUrl,
        accessToken: token,
        previousUrl: editingUrl || undefined,
      });
      if (result.rejection) {
        setError(t(rejectionKey[result.rejection]));
        return;
      }
      resetEditor();
      if ((await result.connection) === 'retrying') setNotice(t('relay.savedRetrying'));
    } catch {
      setError(t('relay.error.saveFailed'));
    } finally {
      setPending(false);
    }
  };

  const editingExistingRelay = Boolean(editingUrl);
  const canSave = Boolean(url.trim());

  return (
    <>
      <SettingsSectionItem title={t('space.advanced.title')}>
        <ListItem
          modifiers={[testID('relay-settings'), clickable(() => {
            setShowRelaySettings(true);
            void refresh().catch(() => setNotice(t('relay.error.refreshFailed')));
          })]}
        >
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
                  {notice ? <ComposeText color={colors.onSurfaceVariant}>{notice}</ComposeText> : null}
                  <Spacer modifiers={[heightModifier(20)]} />
                  {configuredUrls.length === 0 ? (
                    <ComposeText color={colors.onSurfaceVariant}>{t('relay.summary')}</ComposeText>
                  ) : (
                    relays.map((relay) => (
                      <ListItem
                        key={relay.url}
                        modifiers={[clickable(() => openEditRelay(relay.url))]}
                      >
                        <ListItem.HeadlineContent>
                          <ComposeText>{relay.url}</ComposeText>
                        </ListItem.HeadlineContent>
                        {relay.credentialConfigured ? (
                          <ListItem.SupportingContent>
                            <ComposeText color={colors.onSurfaceVariant}>
                              {t('relay.credentialConfigured')}
                            </ComposeText>
                          </ListItem.SupportingContent>
                        ) : null}
                        <ListItem.TrailingContent>
                          <Icon source={ICONS.chevron} size={20} tint={colors.onSurfaceVariant} />
                        </ListItem.TrailingContent>
                      </ListItem>
                    ))
                  )}
                  <Spacer modifiers={[heightModifier(20)]} />
                  <Button
                    onClick={openAddRelay}
                    modifiers={[testID('relay-add'), fillMaxWidth()]}
                  >
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
                    testID="relay-url-input"
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://relay.example.com"
                    keyboardType="uri"
                    fullWidth
                  />
                  <Spacer modifiers={[heightModifier(16)]} />
                  <ComposeText color={colors.onSurfaceVariant}>{t('relay.token')}</ComposeText>
                  <Spacer modifiers={[heightModifier(6)]} />
                  <AppTextField
                    testID="relay-token-input"
                    value={token}
                    onChangeText={setToken}
                    fullWidth
                  />
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
                    modifiers={[testID('relay-save'), fillMaxWidth()]}
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
