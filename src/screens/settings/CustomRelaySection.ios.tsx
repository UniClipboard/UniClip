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

import type { RelayMutationRejection } from '@/features/relaySettings';
import { SettingsNavRow } from './ios/common';
import { useCustomRelaySettings } from './useCustomRelaySettings';

const rejectionKey: Record<RelayMutationRejection, string> = {
  invalidUrl: 'relay.error.invalidUrl',
  duplicate: 'relay.error.duplicate',
  notFound: 'relay.error.notFound',
};

export function CustomRelaySection() {
  const { t } = useTranslation('settingsSync');
  const { relays, save: saveRelay, initialRefreshFailed } = useCustomRelaySettings();
  const configuredUrls = relays.map(({ url: relayUrl }) => relayUrl);
  const url = useNativeState('');
  const token = useNativeState('');
  const [urlValue, setUrlValue] = useState('');
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (initialRefreshFailed) setNotice(t('relay.error.refreshFailed'));
  }, [initialRefreshFailed, t]);

  useEffect(() => {
    if (editingUrl && !configuredUrls.includes(editingUrl)) setEditingUrl(null);
  }, [configuredUrls, editingUrl]);

  const resetEditor = useCallback(() => {
    setEditingUrl(null);
    url.value = '';
    setUrlValue('');
    token.value = '';
    setError(null);
    setNotice(null);
  }, [token, url]);

  const openAddRelay = useCallback(() => {
    setEditingUrl('');
    url.value = '';
    setUrlValue('');
    token.value = '';
    setError(null);
    setNotice(null);
  }, [token, url]);

  const openEditRelay = useCallback(
    (configuredUrl: string) => {
      setEditingUrl(configuredUrl);
      url.value = configuredUrl;
      setUrlValue(configuredUrl);
      token.value = '';
    setError(null);
    setNotice(null);
    },
    [token, url]
  );

  const save = useCallback(
    async (nextUrl = urlValue) => {
      if (editingUrl === null) return;
      setPending(true);
      setError(null);
      try {
        const result = await saveRelay({
          url: nextUrl,
          accessToken: token.value,
          previousUrl: editingUrl || undefined,
        });
        if (result.rejection) {
          setError(t(rejectionKey[result.rejection]));
          if (result.rejection === 'duplicate') resetEditor();
          return;
        }
        resetEditor();
        if ((await result.connection) === 'retrying') setNotice(t('relay.savedRetrying'));
      } catch {
        setError(t('relay.error.saveFailed'));
      } finally {
        setPending(false);
      }
    },
    [editingUrl, resetEditor, saveRelay, t, token, urlValue]
  );

  const editingExistingRelay = Boolean(editingUrl);

  return (
    <Section
      header={<SwiftUIText>{t('relay.title')}</SwiftUIText>}
      footer={<SwiftUIText>{t('relay.footer')}</SwiftUIText>}
    >
      {editingUrl === null ? (
        <>
          {notice ? <SwiftUIText>{notice}</SwiftUIText> : null}
          {relays.map((relay) => (
            <SettingsNavRow
              key={relay.url}
              title={relay.url}
              subtitle={relay.credentialConfigured ? t('relay.credentialConfigured') : undefined}
              onPress={() => openEditRelay(relay.url)}
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
