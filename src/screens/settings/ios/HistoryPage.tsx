import { Picker, Section, Text as SwiftUIText, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';

import { IosSheetForm, IosSheetPage } from '@/components/ui';
import { useSettingsStore } from '@/stores';
import type { AppSettings } from '@/types/settings';
import { SettingsToggle } from './common';

/** 历史上限的可选值(最小 10);当前值不在表中时补进去,不会被悄悄改掉 */
const MAX_ITEMS_OPTIONS = [100, 200, 500, 1000, 2000, 5000, 10000];
type ImageAutoDownload = AppSettings['attachmentAutoDownload'];
const AUTO_DOWNLOAD_VALUES: ImageAutoDownload[] = ['wifi', 'always', 'off'];

/** 历史记录:最大保留条数、图片自动下载、图片复制按钮 */
export function HistoryPage() {
  const { t } = useTranslation('settingsStorage');
  const { config, updateConfig } = useSettingsStore();
  if (!config) return null;

  const maxItemsOptions = MAX_ITEMS_OPTIONS.includes(config.maxHistoryItems)
    ? MAX_ITEMS_OPTIONS
    : [...MAX_ITEMS_OPTIONS, config.maxHistoryItems].sort((a, b) => a - b);

  const setMaxItems = async (maxItems: number) => {
    const result = await updateConfig({ maxHistoryItems: maxItems });
    if (!result.ok) return;
    const { historyStorage } = await import('@/features/history');
    historyStorage.setMaxHistorySize(maxItems);
  };

  return (
    <IosSheetPage title={t('category.history', { ns: 'settings' })}>
      <IosSheetForm>
        <Section>
          <Picker
            testID="history-max-items"
            selection={config.maxHistoryItems}
            onSelectionChange={(value) => void setMaxItems(Number(value))}
            modifiers={[pickerStyle('menu')]}
            label={
              <VStack alignment="leading" spacing={2}>
                <SwiftUIText>{t('history.maxItemsLabel')}</SwiftUIText>
                <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
                  {t('history.maxItemsHint')}
                </SwiftUIText>
              </VStack>
            }
          >
            {maxItemsOptions.map((value) => (
              <SwiftUIText key={value} modifiers={[tag(value)]}>
                {value.toLocaleString()}
              </SwiftUIText>
            ))}
          </Picker>
          <Picker
            testID="history-auto-download"
            label={t('history.autoDownloadLabel')}
            selection={config.attachmentAutoDownload}
            onSelectionChange={(value) =>
              void updateConfig({ attachmentAutoDownload: value as ImageAutoDownload })
            }
            modifiers={[pickerStyle('menu')]}
          >
            {AUTO_DOWNLOAD_VALUES.map((value) => (
              <SwiftUIText key={value} modifiers={[tag(value)]}>
                {t(`autoDownload.${value}`)}
              </SwiftUIText>
            ))}
          </Picker>
          <SettingsToggle
            testID="history-image-copy-button"
            isOn={config.showImageCopyButton ?? false}
            onIsOnChange={(v) => void updateConfig({ showImageCopyButton: v })}
          >
            <VStack alignment="leading" spacing={2}>
              <SwiftUIText>{t('history.showCopyButtonLabel')}</SwiftUIText>
              <SwiftUIText modifiers={[font({ size: 13 }), foregroundStyle('secondary')]}>
                {t('history.showCopyButtonHint')}
              </SwiftUIText>
            </VStack>
          </SettingsToggle>
        </Section>
      </IosSheetForm>
    </IosSheetPage>
  );
}
