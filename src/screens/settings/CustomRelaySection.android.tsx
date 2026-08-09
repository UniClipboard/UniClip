import { useState } from 'react';
import { Button, Column, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { AppTextField } from '@/components/ui';
import { saveCustomRelay } from '@/features/relaySettings';
import { useSettingsStore } from '@/stores';
import { SettingsSectionItem } from './SettingsSectionItem';

export function CustomRelaySection() {
  const { t } = useTranslation('settingsSync');
  const configuredUrl = useSettingsStore((state) => state.config?.customRelayUrl ?? '');
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const [url, setUrl] = useState(configuredUrl);
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await saveCustomRelay({ url, accessToken: token, previousUrl: configuredUrl });
      const update = await updateConfig({ customRelayUrl: result.configured ? url.trim() : '' });
      if (!update.ok) throw new Error(update.error);
      setToken('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('relay.error.saveFailed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsSectionItem title={t('relay.title')} footer={t('relay.footer')}>
      <Column modifiers={[fillMaxWidth(), padding(16, 16, 16, 16)]}>
        <AppTextField
          value={url}
          onChangeText={setUrl}
          label={t('relay.url')}
          placeholder="https://relay.example.com"
          keyboardType="uri"
          fullWidth
        />
        <AppTextField
          value={token}
          onChangeText={setToken}
          label={t('relay.token')}
          secure
          fullWidth
        />
        {error ? <ComposeText color="#B3261E">{error}</ComposeText> : null}
        <Button onClick={() => void save()} enabled={!pending} modifiers={[fillMaxWidth()]}>
          <ComposeText>{url.trim() ? t('relay.save') : t('relay.remove')}</ComposeText>
        </Button>
      </Column>
    </SettingsSectionItem>
  );
}
