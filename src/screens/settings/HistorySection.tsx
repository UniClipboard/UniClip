/**
 * 历史记录 section
 *
 * 订阅 attachmentAutoDownload / showImageCopyButton。
 */
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListItem,
  OutlinedTextField,
  Text as ComposeText,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { width as widthModifier } from '@expo/ui/jetpack-compose/modifiers';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { useBlurCommit } from './useBlurCommit';
import { SettingsSectionItem, useSettingsSectionRowColors } from './SettingsSectionItem';
import { SettingsSelectRow } from './android/SettingsSelectRow';
import { SettingsSwitchRow } from './android/SettingsSwitchRow';

type ImageAutoDownload = 'wifi' | 'always' | 'off';
const IMAGE_AUTO_DOWNLOAD_VALUES: ImageAutoDownload[] = ['wifi', 'always', 'off'];

/** 输入型行:交互就是行尾的数字输入框,行本身不可点;容器色需在分组上下文内读取。 */
function MaxHistoryItemsRow({
  value,
  onValueChange,
  onFocusChanged,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onFocusChanged: (focused: boolean) => void;
}) {
  const { t } = useTranslation('settingsStorage');
  const rowColors = useSettingsSectionRowColors();
  const nativeValue = useNativeState(value);
  return (
    <ListItem colors={rowColors}>
      <ListItem.HeadlineContent>
        <ComposeText>{t('history.maxItemsLabel')}</ComposeText>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <ComposeText>{t('history.maxItemsHint')}</ComposeText>
      </ListItem.SupportingContent>
      <ListItem.TrailingContent>
        <OutlinedTextField
          value={nativeValue}
          onValueChange={onValueChange}
          onFocusChanged={onFocusChanged}
          keyboardOptions={{ keyboardType: 'number' }}
          singleLine
          modifiers={[widthModifier(112)]}
        >
          <OutlinedTextField.Placeholder>
            <ComposeText>100</ComposeText>
          </OutlinedTextField.Placeholder>
          <OutlinedTextField.Suffix>
            <ComposeText>{t('history.maxItemsSuffix')}</ComposeText>
          </OutlinedTextField.Suffix>
        </OutlinedTextField>
      </ListItem.TrailingContent>
    </ListItem>
  );
}

export const HistorySection = memo(function HistorySection() {
  const { t } = useTranslation('settingsStorage');
  const showMessage = useSettingsToast();

  const attachmentAutoDownload = useSettingsStore(
    (s) => (s.config?.attachmentAutoDownload ?? 'wifi') as ImageAutoDownload
  );
  const showImageCopyButton = useSettingsStore((s) => s.config?.showImageCopyButton ?? false);

  const [maxHistoryItemsInput, setMaxHistoryItemsInput] = useState(() =>
    (useSettingsStore.getState().config?.maxHistoryItems ?? 1000).toString()
  );

  const imageAutoDownloadOptions = IMAGE_AUTO_DOWNLOAD_VALUES.map((value) => ({
    value,
    label: t(`autoDownload.${value}`),
  }));

  const handleMaxHistoryItemsBlur = async () => {
    const resetToCurrent = () =>
      setMaxHistoryItemsInput(
        (useSettingsStore.getState().config?.maxHistoryItems ?? 1000).toString()
      );
    try {
      const maxItems = parseInt(maxHistoryItemsInput, 10);
      if (isNaN(maxItems) || maxItems < 10) {
        resetToCurrent();
        showMessage(t('history.maxItemsInvalid'), 'error');
        return;
      }
      await useSettingsStore.getState().updateConfig({ maxHistoryItems: maxItems });
      const { historyStorage } = await import('@/features/history');
      historyStorage.setMaxHistorySize(maxItems);
    } catch (error: unknown) {
      resetToCurrent();
      showMessage(error instanceof Error ? error.message : t('setFailed'), 'error');
    }
  };

  const handleImageAutoDownloadChange = async (value: ImageAutoDownload) => {
    try {
      await useSettingsStore.getState().updateConfig({ attachmentAutoDownload: value });
    } catch {
      // store 失败回滚 config，下拉显示自动恢复
    }
  };

  const onMaxHistoryItemsFocusChanged = useBlurCommit(handleMaxHistoryItemsBlur);

  return (
    <SettingsSectionItem variant="grouped">
      <MaxHistoryItemsRow
        key="maxItems"
        value={maxHistoryItemsInput}
        onValueChange={setMaxHistoryItemsInput}
        onFocusChanged={onMaxHistoryItemsFocusChanged}
      />
      <SettingsSelectRow
        key="autoDownload"
        title={t('history.autoDownloadLabel')}
        options={imageAutoDownloadOptions}
        selectedValue={attachmentAutoDownload}
        onSelect={(value) => void handleImageAutoDownloadChange(value)}
      />
      <SettingsSwitchRow
        key="showCopyButton"
        title={t('history.showCopyButtonLabel')}
        description={t('history.showCopyButtonHint')}
        value={showImageCopyButton}
        onValueChange={(enabled) =>
          void useSettingsStore.getState().updateConfig({ showImageCopyButton: enabled })
        }
      />
    </SettingsSectionItem>
  );
});
