import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  HStack,
  Image,
  Section,
  Text as SwiftUIText,
  TextField,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  disabled,
  font,
  foregroundStyle,
  keyboardType,
  listRowBackground,
} from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { BUILT_IN_USAGE_KEY, describeRelayOverview } from '@/features/relayOverview';
import type { RelayMutationRejection } from '@/features/relaySettings';
import { SettingsNavRow, settingsTileColors } from '@/screens/settings/ios/common';
import type { useCustomRelaySettings } from '@/screens/settings/useCustomRelaySettings';

const rejectionKey: Record<RelayMutationRejection, string> = {
  invalidUrl: 'relay.error.invalidUrl',
  duplicate: 'relay.error.duplicate',
  notFound: 'relay.error.notFound',
};

// Translucent tints read correctly in both light and dark appearance.
const STATUS_BACKGROUND = {
  info: 'rgba(0, 122, 255, 0.12)',
  warn: 'rgba(255, 149, 0, 0.16)',
} as const;

export type RelaySettingsController = ReturnType<typeof useCustomRelaySettings>;

/**
 * 中继设置(空间设置推入):状态卡、只读的内置节点、可编辑的自定义节点。
 * 状态由 DevicesScreen 持有的同一个 controller 提供,本页不创建第二份,也不渲染任何 sheet。
 */
export function RelaySettingsPage({ relay }: { relay: RelaySettingsController }) {
  const { t } = useTranslation('settingsSync');
  const { relays, save: saveRelay, refresh, initialRefreshFailed, overview, retryOverview } = relay;
  const configuredUrls = relays.map(({ url: relayUrl }) => relayUrl);
  const url = useNativeState('');
  const token = useNativeState('');
  const [urlValue, setUrlValue] = useState('');
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The tab may have read Engine before it was ready; re-read each time this page opens.
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

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

  const view = overview.status === 'ready' ? describeRelayOverview(overview.value) : null;
  const editingExistingRelay = Boolean(editingUrl);

  const statusCard = view ? (
    <Section>
      <HStack
        spacing={12}
        modifiers={[listRowBackground(STATUS_BACKGROUND[view.tone])]}
        alignment="top"
      >
        <Image
          systemName="info.circle.fill"
          size={22}
          color={view.tone === 'warn' ? settingsTileColors.orange : settingsTileColors.blue}
        />
        <VStack alignment="leading" spacing={2}>
          <SwiftUIText modifiers={[font({ size: 15, weight: 'semibold' })]}>
            {view.changePending ? t('relay.status.pendingTitle') : t(view.statusKey)}
          </SwiftUIText>
          <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
            {view.changePending ? t('relay.status.pending') : t(view.statusHintKey)}
          </SwiftUIText>
          {view.nodeNotStarted ? (
            <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
              {t('relay.status.nodeNotStarted')}
            </SwiftUIText>
          ) : null}
        </VStack>
      </HStack>
    </Section>
  ) : null;

  const builtInSection = (
    <Section
      header={<SwiftUIText>{t('relay.builtIn.title')}</SwiftUIText>}
      footer={<SwiftUIText>{t('relay.builtIn.footer')}</SwiftUIText>}
    >
      {overview.status === 'loading' ? (
        <SwiftUIText>{t('relay.builtIn.loading')}</SwiftUIText>
      ) : null}
      {overview.status === 'error' ? (
        <SettingsNavRow
          testID="relay-overview-retry"
          icon="exclamationmark.circle"
          title={t('relay.builtIn.loadFailed')}
          value={t('relay.retry')}
          showsChevron={false}
          onPress={() => {
            setNotice(null);
            void retryOverview();
          }}
        />
      ) : null}
      {view?.builtInRows.map((row) => (
        <SettingsNavRow
          key={row.key}
          readOnly
          dimmed={row.usage === 'replacedByCustom' || row.usage === 'off'}
          showsChevron={false}
          title={row.regionKey ? t(row.regionKey) : row.url}
          subtitle={[row.regionKey ? row.url : null, t(BUILT_IN_USAGE_KEY[row.usage])]
            .filter(Boolean)
            .join('\n')}
          value={t('relay.source.builtIn')}
        />
      ))}
    </Section>
  );

  const customSection = (
    <Section
      header={<SwiftUIText>{t('relay.title')}</SwiftUIText>}
      footer={<SwiftUIText>{t('relay.listFooter')}</SwiftUIText>}
    >
      {notice ? <SwiftUIText>{notice}</SwiftUIText> : null}
      {relays.map((configured) => (
        <SettingsNavRow
          key={configured.url}
          title={configured.url}
          subtitle={configured.credentialConfigured ? t('relay.credentialConfigured') : undefined}
          onPress={() => openEditRelay(configured.url)}
        />
      ))}
      <SettingsNavRow
        testID="relay-add"
        icon="plus"
        title={t('relay.add')}
        onPress={openAddRelay}
        showsChevron={false}
      />
    </Section>
  );

  return (
    <IosSheetPage title={t('relay.page.title')}>
      <IosSheetForm>
        {editingUrl === null ? (
          <>
            {statusCard}
            {/* A saved custom relay replaces the built-in list, so it leads the page. */}
            {relays.length > 0 ? (
              <>
                {customSection}
                {builtInSection}
              </>
            ) : (
              <>
                {builtInSection}
                {customSection}
              </>
            )}
          </>
        ) : (
          <Section
            header={
              <SwiftUIText>{editingExistingRelay ? t('relay.edit') : t('relay.add')}</SwiftUIText>
            }
            footer={<SwiftUIText>{t('relay.footer')}</SwiftUIText>}
          >
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
          </Section>
        )}
      </IosSheetForm>
    </IosSheetPage>
  );
}
