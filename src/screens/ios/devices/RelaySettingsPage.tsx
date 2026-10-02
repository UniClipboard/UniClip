import { useEffect, useState } from 'react';
import { HStack, Image, Section, Text as SwiftUIText, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, listRowBackground } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { BUILT_IN_USAGE_KEY, describeRelayOverview } from '@/features/relayOverview';
import { SettingsNavRow, settingsTileColors } from '@/screens/settings/ios/common';
import type { useCustomRelaySettings } from '@/screens/settings/useCustomRelaySettings';

// Translucent tints read correctly in both light and dark appearance.
const STATUS_BACKGROUND = {
  info: 'rgba(0, 122, 255, 0.12)',
  warn: 'rgba(255, 149, 0, 0.16)',
} as const;

export type RelaySettingsController = ReturnType<typeof useCustomRelaySettings>;

/**
 * 中继设置(空间设置推入):状态卡、只读的内置节点、自定义节点列表。
 * 新增 / 编辑是再推入一层的独立页面(RelayEditorPage),本页只汇报点按,不持有编辑状态。
 * 状态由 DevicesScreen 持有的同一个 controller 提供,本页不创建第二份,也不渲染任何 sheet。
 */
export function RelaySettingsPage({
  relay,
  onAddRelay,
  onEditRelay,
}: {
  relay: RelaySettingsController;
  onAddRelay: () => void;
  onEditRelay: (url: string) => void;
}) {
  const { t } = useTranslation('settingsSync');
  const { relays, refresh, initialRefreshFailed, overview, retryOverview } = relay;
  const [notice, setNotice] = useState<string | null>(null);

  // The tab may have read Engine before it was ready; re-read each time this page opens.
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (initialRefreshFailed) setNotice(t('relay.error.refreshFailed'));
  }, [initialRefreshFailed, t]);

  const view = overview.status === 'ready' ? describeRelayOverview(overview.value) : null;
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
          onPress={() => onEditRelay(configured.url)}
        />
      ))}
      <SettingsNavRow
        testID="relay-add"
        icon="plus"
        title={t('relay.add')}
        onPress={onAddRelay}
        showsChevron={false}
      />
    </Section>
  );

  return (
    <IosSheetPage title={t('relay.page.title')}>
      <IosSheetForm>
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
      </IosSheetForm>
    </IosSheetPage>
  );
}
