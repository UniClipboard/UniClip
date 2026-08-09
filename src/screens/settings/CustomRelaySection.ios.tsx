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

export function CustomRelaySection() {
  const { t } = useTranslation('settingsSync');
  const configuredUrl = useSettingsStore((state) => state.config?.customRelayUrl ?? '');
  const updateConfig = useSettingsStore((state) => state.updateConfig);
  const url = useNativeState(configuredUrl);
  const token = useNativeState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    url.value = configuredUrl;
  }, [configuredUrl, url]);

  const save = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const result = await saveCustomRelay({
        url: url.value,
        accessToken: token.value,
        previousUrl: configuredUrl,
      });
      const update = await updateConfig({
        customRelayUrl: result.configured ? url.value.trim() : '',
      });
      if (!update.ok) throw new Error(update.error);
      token.value = '';
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('relay.error.saveFailed'));
    } finally {
      setPending(false);
    }
  }, [configuredUrl, t, token, updateConfig, url]);

  return (
    <Section
      header={<SwiftUIText>{t('relay.title')}</SwiftUIText>}
      footer={<SwiftUIText>{t('relay.footer')}</SwiftUIText>}
    >
      <TextField
        text={url}
        placeholder="https://relay.example.com"
        modifiers={[keyboardType('url'), autocorrectionDisabled()]}
      />
      <SecureField text={token} placeholder={t('relay.token')} />
      {error ? <SwiftUIText>{error}</SwiftUIText> : null}
      <Button
        label={url.value.trim() ? t('relay.save') : t('relay.remove')}
        onPress={() => void save()}
        modifiers={[disabled(pending)]}
      />
    </Section>
  );
}
