import { useState } from 'react';
import {
  Button,
  Column,
  OutlinedButton,
  Spacer,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height as heightModifier,
  imePadding,
  testID,
} from '@expo/ui/jetpack-compose/modifiers';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { AppTextField } from '@/components/ui';
import type { RelayMutationRejection } from '@/features/relaySettings';
import type { RootStackParamList } from '@/navigation/AppNavigator.types';
import { useCustomRelaySettings } from '../useCustomRelaySettings';

const rejectionKey: Record<RelayMutationRejection, string> = {
  invalidUrl: 'relay.error.invalidUrl',
  duplicate: 'relay.error.duplicate',
  notFound: 'relay.error.notFound',
};

/**
 * Add or edit one custom relay, pushed on top of the relay page (`relayUrl` absent = add).
 * Back, save and remove all return to the relay page; other screens learn about the change
 * through `announceRelayChange`, so this page keeps no list state of its own.
 */
export function RelayEditorSection({ relayUrl }: { relayUrl?: string }) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { save: saveRelay } = useCustomRelaySettings();
  const [url, setUrl] = useState(relayUrl ?? '');
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editingExistingRelay = Boolean(relayUrl);

  const save = async (nextUrl = url) => {
    setPending(true);
    setError(null);
    try {
      const result = await saveRelay({
        url: nextUrl,
        accessToken: token,
        previousUrl: relayUrl || undefined,
      });
      if (result.rejection) {
        setError(t(rejectionKey[result.rejection]));
        return;
      }
      navigation.goBack();
    } catch {
      setError(t('relay.error.saveFailed'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Column modifiers={[fillMaxWidth(), imePadding()]}>
      <ComposeText color={colors.onSurfaceVariant}>{t('relay.footer')}</ComposeText>
      <Spacer modifiers={[heightModifier(16)]} />
      <AppTextField
        testID="relay-url-input"
        value={url}
        onChangeText={setUrl}
        label={t('relay.url')}
        placeholder="https://relay.example.com"
        keyboardType="uri"
        fullWidth
      />
      <Spacer modifiers={[heightModifier(12)]} />
      <AppTextField
        testID="relay-token-input"
        value={token}
        onChangeText={setToken}
        label={t('relay.token')}
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
        enabled={!pending && Boolean(url.trim())}
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
            modifiers={[testID('relay-remove'), fillMaxWidth()]}
          >
            <ComposeText color={colors.error}>{t('relay.remove')}</ComposeText>
          </OutlinedButton>
        </>
      ) : null}
      <TextButton
        onClick={() => navigation.goBack()}
        enabled={!pending}
        modifiers={[fillMaxWidth()]}
      >
        <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
      </TextButton>
    </Column>
  );
}
