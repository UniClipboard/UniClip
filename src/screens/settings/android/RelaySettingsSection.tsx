import { useEffect, useState } from 'react';
import {
  Button,
  Column,
  Icon,
  ListItem,
  OutlinedButton,
  Row,
  Shape,
  Spacer,
  Surface,
  Text as ComposeText,
  TextButton,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  clickable,
  fillMaxWidth,
  height as heightModifier,
  imePadding,
  padding,
  testID,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTranslation } from 'react-i18next';

import { AppTextField } from '@/components/ui';
import {
  BUILT_IN_USAGE_KEY,
  describeRelayOverview,
  type RelaySummary,
} from '@/features/relayOverview';
import type { RelayMutationRejection } from '@/features/relaySettings';
import { SettingsSectionItem, useSettingsSectionRowColors } from '../SettingsSectionItem';
import { useCustomRelaySettings } from '../useCustomRelaySettings';
import { SettingsLeadingIcon } from './SettingsLeadingIcon';

const ICONS = {
  add: require('../../../assets/icons/add.xml'),
  chevron: require('../../../assets/icons/chevron_right.xml'),
  info: require('../../../assets/icons/info.xml'),
  relay: require('../../../assets/icons/public.xml'),
};

const rejectionKey: Record<RelayMutationRejection, string> = {
  invalidUrl: 'relay.error.invalidUrl',
  duplicate: 'relay.error.duplicate',
  notFound: 'relay.error.notFound',
};

const STATUS_SHAPE = Shape.RoundedCorner({
  cornerRadii: { topStart: 24, topEnd: 24, bottomStart: 24, bottomEnd: 24 },
});
const STATUS_TITLE_STYLE = { fontSize: 16, fontWeight: '500', letterSpacing: 0.15 } as const;
const SECTION_TITLE_STYLE = { fontSize: 20, fontWeight: '600', letterSpacing: 0 } as const;

function summaryText(
  summary: RelaySummary,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (summary.kind === 'custom') return t('relay.configuredCount', { count: summary.count });
  return summary.kind === 'off' ? t('relay.status.off') : t('relay.source.builtIn');
}

/** Entry row in Space settings. The whole row opens the relay page. */
export function RelayEntryRow({
  summary,
  onOpen,
}: {
  summary: RelaySummary | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  return (
    <ListItem colors={rowColors} modifiers={[testID('relay-settings'), clickable(onOpen)]}>
      <ListItem.LeadingContent>
        <SettingsLeadingIcon source={ICONS.relay} />
      </ListItem.LeadingContent>
      <ListItem.HeadlineContent>
        <ComposeText>{t('relay.page.title')}</ComposeText>
      </ListItem.HeadlineContent>
      {summary ? (
        <ListItem.SupportingContent>
          <ComposeText color={colors.onSurfaceVariant}>{summaryText(summary, t)}</ComposeText>
        </ListItem.SupportingContent>
      ) : null}
      <ListItem.TrailingContent>
        <Icon source={ICONS.chevron} size={20} tint={colors.onSurfaceVariant} />
      </ListItem.TrailingContent>
    </ListItem>
  );
}

/** Network group of Space settings: the relay entry row with the saved routing as summary. */
export function RelayEntrySection({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation('settingsSync');
  const { overview } = useCustomRelaySettings();
  const summary = overview.status === 'ready' ? describeRelayOverview(overview.value).summary : null;
  return (
    <SettingsSectionItem variant="grouped" title={t('relay.page.network')}>
      <RelayEntryRow summary={summary} onOpen={onOpen} />
    </SettingsSectionItem>
  );
}

export function RelaySettingsSection() {
  const { t } = useTranslation('settingsSync');
  const colors = useMaterialColors();
  const rowColors = useSettingsSectionRowColors();
  const {
    relays,
    refresh,
    save: saveRelay,
    initialRefreshFailed,
    overview,
    retryOverview,
  } = useCustomRelaySettings();
  const configuredUrls = relays.map(({ url: relayUrl }) => relayUrl);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Re-read each time the page opens: the first read can race Engine startup.
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    void refresh().catch(() => setRefreshFailed(true));
  }, [refresh]);

  useEffect(() => {
    if (initialRefreshFailed || refreshFailed) setNotice(t('relay.error.refreshFailed'));
  }, [initialRefreshFailed, refreshFailed, t]);

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

  const view = overview.status === 'ready' ? describeRelayOverview(overview.value) : null;
  const editingExistingRelay = Boolean(editingUrl);

  if (editingUrl !== null) {
    return (
      <Column modifiers={[fillMaxWidth(), imePadding()]}>
        <ComposeText style={SECTION_TITLE_STYLE}>
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
        <AppTextField testID="relay-token-input" value={token} onChangeText={setToken} fullWidth />
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
    );
  }

  const [statusContainer, statusContent] =
    view?.tone === 'warn'
      ? [colors.tertiaryContainer, colors.onTertiaryContainer]
      : [colors.primaryContainer, colors.onPrimaryContainer];

  const statusCard = view ? (
    <SettingsSectionItem variant="plain">
      <Surface color={statusContainer} shape={STATUS_SHAPE} modifiers={[fillMaxWidth()]}>
        <Row modifiers={[fillMaxWidth(), padding(16, 16, 16, 16)]} verticalAlignment="top">
          <Icon source={ICONS.info} size={24} tint={statusContent} />
          <Spacer modifiers={[widthModifier(16)]} />
          <Column modifiers={[fillMaxWidth()]}>
            <ComposeText color={statusContent} style={STATUS_TITLE_STYLE}>
              {view.changePending ? t('relay.status.pendingTitle') : t(view.statusKey)}
            </ComposeText>
            <ComposeText color={statusContent}>
              {view.changePending ? t('relay.status.pending') : t(view.statusHintKey)}
            </ComposeText>
            {view.nodeNotStarted ? (
              <ComposeText color={statusContent}>{t('relay.status.nodeNotStarted')}</ComposeText>
            ) : null}
          </Column>
        </Row>
      </Surface>
    </SettingsSectionItem>
  ) : null;

  const builtInSection = (
    <SettingsSectionItem
      variant="grouped"
      title={t('relay.builtIn.title')}
      footer={t('relay.builtIn.footer')}
    >
      {overview.status === 'loading' ? (
        <ListItem colors={rowColors}>
          <ListItem.HeadlineContent>
            <ComposeText color={colors.onSurfaceVariant}>{t('relay.builtIn.loading')}</ComposeText>
          </ListItem.HeadlineContent>
        </ListItem>
      ) : null}
      {overview.status === 'error' ? (
        <ListItem
          colors={rowColors}
          modifiers={[
            testID('relay-overview-retry'),
            clickable(() => {
              setNotice(null);
              void retryOverview();
            }),
          ]}
        >
          <ListItem.LeadingContent>
            <SettingsLeadingIcon source={ICONS.info} tone="error" />
          </ListItem.LeadingContent>
          <ListItem.HeadlineContent>
            <ComposeText>{t('relay.builtIn.loadFailed')}</ComposeText>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <ComposeText color={colors.onSurfaceVariant}>{t('relay.builtIn.retryHint')}</ComposeText>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <ComposeText color={colors.primary}>{t('relay.retry')}</ComposeText>
          </ListItem.TrailingContent>
        </ListItem>
      ) : null}
      {view?.builtInRows.map((row) => {
        const dim = row.usage === 'replacedByCustom' || row.usage === 'off';
        return (
          <ListItem
            key={row.key}
            colors={rowColors}
            modifiers={[testID(`relay-builtin-${row.key}`)]}
          >
            <ListItem.HeadlineContent>
              <ComposeText color={dim ? colors.onSurfaceVariant : colors.onSurface}>
                {row.regionKey ? t(row.regionKey) : row.url}
              </ComposeText>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <Column>
                {row.regionKey ? (
                  <ComposeText color={colors.onSurfaceVariant}>{row.url}</ComposeText>
                ) : null}
                <ComposeText color={colors.onSurfaceVariant}>
                  {t(BUILT_IN_USAGE_KEY[row.usage])}
                </ComposeText>
              </Column>
            </ListItem.SupportingContent>
            <ListItem.TrailingContent>
              <ComposeText color={colors.onSurfaceVariant}>{t('relay.source.builtIn')}</ComposeText>
            </ListItem.TrailingContent>
          </ListItem>
        );
      })}
    </SettingsSectionItem>
  );

  const customSection = (
    <>
      {relays.length > 0 ? (
        <SettingsSectionItem variant="grouped" title={t('relay.title')}>
          {relays.map((relay) => (
            <ListItem
              key={relay.url}
              colors={rowColors}
              modifiers={[clickable(() => openEditRelay(relay.url))]}
            >
              <ListItem.LeadingContent>
                <SettingsLeadingIcon source={ICONS.relay} />
              </ListItem.LeadingContent>
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
          ))}
        </SettingsSectionItem>
      ) : null}
      <SettingsSectionItem
        variant="plain"
        title={relays.length > 0 ? undefined : t('relay.title')}
        footer={t('relay.listFooter')}
      >
        <Button onClick={openAddRelay} modifiers={[testID('relay-add'), fillMaxWidth()]}>
          <Icon source={ICONS.add} size={18} tint={colors.onPrimary} />
          <Spacer modifiers={[widthModifier(8)]} />
          <ComposeText>{t('relay.add')}</ComposeText>
        </Button>
      </SettingsSectionItem>
    </>
  );

  return (
    <Column modifiers={[fillMaxWidth()]}>
      {statusCard}
      {notice ? (
        <Column modifiers={[padding(4, 12, 4, 0)]}>
          <ComposeText color={colors.error}>{notice}</ComposeText>
        </Column>
      ) : null}
      <Spacer modifiers={[heightModifier(24)]} />
      {/* A saved custom relay replaces the built-in list, so it leads the page. */}
      {relays.length > 0 ? (
        <>
          {customSection}
          <Spacer modifiers={[heightModifier(24)]} />
          {builtInSection}
        </>
      ) : (
        <>
          {builtInSection}
          <Spacer modifiers={[heightModifier(24)]} />
          {customSection}
        </>
      )}
    </Column>
  );
}
