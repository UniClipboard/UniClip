import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Section,
  SecureField,
  Text as SwiftUIText,
  TextField,
  useNativeState,
} from '@expo/ui/swift-ui';
import { autocorrectionDisabled, disabled, keyboardType } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { saveCustomRelay } from '@/features/relaySettings';
import { useSettingsStore } from '@/stores';

const EMPTY_RELAY_URLS: string[] = [];

export function CustomRelaySection() {
  const { t } = useTranslation('settingsSync');
  const configuredUrls = useSettingsStore(
    (state) => state.config?.customRelayUrls ?? EMPTY_RELAY_URLS
  );
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const url = useNativeState('');
  const token = useNativeState('');
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingUrl && !configuredUrls.includes(editingUrl)) setEditingUrl(null);
  }, [configuredUrls, editingUrl]);

  const resetEditor = useCallback(() => {
    setEditingUrl(null);
    url.value = '';
    token.value = '';
    setError(null);
  }, [token, url]);

  const openAddRelay = useCallback(() => {
    setEditingUrl('');
    url.value = '';
    token.value = '';
    setError(null);
  }, [token, url]);

  const openEditRelay = useCallback(
    (configuredUrl: string) => {
      setEditingUrl(configuredUrl);
      url.value = configuredUrl;
      token.value = '';
      setError(null);
    },
    [token, url]
  );

  const save = useCallback(
    async (nextUrl = url.value) => {
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
    [configuredUrls, editingUrl, resetEditor, t, token, updateConfig, url]
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
          <Button label={t('relay.add')} onPress={openAddRelay} />
        </>
      ) : (
        <>
          <TextField
            text={url}
            placeholder="https://relay.example.com"
            modifiers={[keyboardType('url'), autocorrectionDisabled()]}
          />
          <SecureField text={token} placeholder={t('relay.token')} />
          {error ? <SwiftUIText>{error}</SwiftUIText> : null}
          <Button
            label={t('relay.save')}
            onPress={() => void save()}
            modifiers={[disabled(pending || !url.value.trim())]}
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
