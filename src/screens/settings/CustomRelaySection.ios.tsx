import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Section,
  Text as SwiftUIText,
  TextField,
  useNativeState,
} from '@expo/ui/swift-ui';
import { autocorrectionDisabled, disabled, keyboardType } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { saveCustomRelay } from '@/features/relaySettings';
import { useSettingsStore } from '@/stores';
import { SettingsNavRow } from './ios/common';

const EMPTY_RELAY_URLS: string[] = [];

export function CustomRelaySection() {
  const { t } = useTranslation('settingsSync');
  const configuredUrls = useSettingsStore(
    (state) => state.config?.customRelayUrls ?? EMPTY_RELAY_URLS
  );
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const url = useNativeState('');
  const token = useNativeState('');
  const [urlValue, setUrlValue] = useState('');
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingUrl && !configuredUrls.includes(editingUrl)) setEditingUrl(null);
  }, [configuredUrls, editingUrl]);

  const resetEditor = useCallback(() => {
    setEditingUrl(null);
    url.value = '';
    setUrlValue('');
    token.value = '';
    setError(null);
  }, [token, url]);

  const openAddRelay = useCallback(() => {
    setEditingUrl('');
    url.value = '';
    setUrlValue('');
    token.value = '';
    setError(null);
  }, [token, url]);

  const openEditRelay = useCallback(
    (configuredUrl: string) => {
      setEditingUrl(configuredUrl);
      url.value = configuredUrl;
      setUrlValue(configuredUrl);
      token.value = '';
      setError(null);
    },
    [token, url]
  );

  const save = useCallback(
    async (nextUrl = urlValue) => {
      if (editingUrl === null) return;
      setPending(true);
      setError(null);
      try {
        const result = await saveCustomRelay({
          url: nextUrl,
          accessToken: token.value,
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
    },
    [configuredUrls, editingUrl, resetEditor, t, token, updateConfig, urlValue]
  );

  const editingExistingRelay = Boolean(editingUrl);

  return (
    <Section
      header={<SwiftUIText>{t('relay.title')}</SwiftUIText>}
      footer={<SwiftUIText>{t('relay.footer')}</SwiftUIText>}
    >
      {editingUrl === null ? (
        <>
          {configuredUrls.map((configuredUrl) => (
            <Button
              key={configuredUrl}
              label={configuredUrl}
              onPress={() => openEditRelay(configuredUrl)}
            />
          ))}
          <SettingsNavRow
            testID="relay-add"
            icon="plus"
            title={t('relay.add')}
            onPress={openAddRelay}
            showsChevron={false}
          />
        </>
      ) : (
        <>
          <TextField
            testID="relay-url-input"
            text={url}
            onTextChange={setUrlValue}
            placeholder="https://relay.example.com"
            modifiers={[keyboardType('url'), autocorrectionDisabled()]}
          />
          <TextField
            testID="relay-token-input"
            text={token}
            placeholder={t('relay.token')}
            modifiers={[autocorrectionDisabled()]}
          />
          {error ? <SwiftUIText>{error}</SwiftUIText> : null}
          <Button
            testID="relay-save"
            label={t('relay.save')}
            onPress={() => void save()}
            modifiers={[disabled(pending || !urlValue.trim())]}
          />
          {editingExistingRelay ? (
            <Button
              label={t('relay.remove')}
              onPress={() => void save('')}
              modifiers={[disabled(pending)]}
            />
          ) : null}
          <Button label={t('action.cancel', { ns: 'common' })} onPress={resetEditor} />
        </>
      )}
    </Section>
  );
}
