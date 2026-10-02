import { useCallback, useEffect, useState } from 'react';
import { Button, Section, Text as SwiftUIText, TextField, useNativeState } from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  disabled,
  keyboardType,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import type { RelayMutationRejection } from '@/features/relaySettings';
import type { RelaySettingsController } from './RelaySettingsPage';

const rejectionKey: Record<RelayMutationRejection, string> = {
  invalidUrl: 'relay.error.invalidUrl',
  duplicate: 'relay.error.duplicate',
  notFound: 'relay.error.notFound',
};

/**
 * 新增 / 编辑一个自定义中继(中继页之上再推入一层)。`editingUrl` 为空串表示新增。
 * 保存或移除成功后调用 onClose,回到中继页;连接重建的结果由中继页的状态卡呈现。
 */
export function RelayEditorPage({
  relay,
  editingUrl,
  onClose,
}: {
  relay: RelaySettingsController;
  editingUrl: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const url = useNativeState(editingUrl);
  const token = useNativeState('');
  const [urlValue, setUrlValue] = useState(editingUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editingExistingRelay = Boolean(editingUrl);

  // The page can be pushed again for another relay: start from that relay's address.
  useEffect(() => {
    url.value = editingUrl;
    setUrlValue(editingUrl);
    token.value = '';
    setError(null);
  }, [editingUrl, token, url]);

  const save = useCallback(
    async (nextUrl = urlValue) => {
      setPending(true);
      setError(null);
      try {
        const result = await relay.save({
          url: nextUrl,
          accessToken: token.value,
          previousUrl: editingUrl || undefined,
        });
        if (result.rejection) {
          setError(t(rejectionKey[result.rejection]));
          return;
        }
        onClose();
      } catch {
        setError(t('relay.error.saveFailed'));
      } finally {
        setPending(false);
      }
    },
    [editingUrl, onClose, relay, t, token, urlValue]
  );

  return (
    <IosSheetPage title={editingExistingRelay ? t('relay.edit') : t('relay.add')}>
      <IosSheetForm>
        <Section footer={<SwiftUIText>{t('relay.footer')}</SwiftUIText>}>
          <TextField
            testID="relay-url-input"
            text={url}
            onTextChange={setUrlValue}
            placeholder="https://relay.example.com"
            modifiers={[keyboardType('url'), autocorrectionDisabled(), textInputAutocapitalization('never')]}
          />
          <TextField
            testID="relay-token-input"
            text={token}
            placeholder={t('relay.token')}
            modifiers={[autocorrectionDisabled(), textInputAutocapitalization('never')]}
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
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
