/**
 * 历史记录 section
 *
 * 订阅 enableHistorySync / attachmentAutoDownload / showImageCopyButton 及当前服务器类型。
 */
import React, { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListItem,
  Switch as ComposeSwitch,
  OutlinedTextField,
  HorizontalDivider,
  ExposedDropdownMenuBox,
  ExposedDropdownMenu,
  DropdownMenuItem,
  Text as ComposeText,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  width as widthModifier,
  menuAnchor,
} from '@expo/ui/jetpack-compose/modifiers';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { useBlurCommit } from './useBlurCommit';
import { SettingsSectionItem } from './SettingsSectionItem';

type ImageAutoDownload = 'wifi' | 'always' | 'off';
const IMAGE_AUTO_DOWNLOAD_VALUES: ImageAutoDownload[] = ['wifi', 'always', 'off'];

export const HistorySection = memo(function HistorySection() {
  const { t } = useTranslation('settingsStorage');
  const showMessage = useSettingsToast();

  const historySyncEnabled = useSettingsStore((s) => s.config?.enableHistorySync ?? false);
  const isSyncClipboard = useSettingsStore((s) => {
    const c = s.config;
    const i = c?.activeServerIndex ?? -1;
    return i >= 0 ? c?.servers?.[i]?.type === 'syncclipboard' : false;
  });
  const attachmentAutoDownload = useSettingsStore(
    (s) => (s.config?.attachmentAutoDownload ?? 'wifi') as ImageAutoDownload
  );
  const showImageCopyButton = useSettingsStore((s) => s.config?.showImageCopyButton ?? false);

  const [maxHistoryItemsInput, setMaxHistoryItemsInput] = useState(() =>
    (useSettingsStore.getState().config?.maxHistoryItems ?? 1000).toString()
  );
  const [showImageAutoDownloadMenu, setShowImageAutoDownloadMenu] = useState(false);

  const imageAutoDownloadOptions = IMAGE_AUTO_DOWNLOAD_VALUES.map((value) => ({
    value,
    label: t(`autoDownload.${value}`),
  }));

  const maxHistoryItemsNativeState = useNativeState(maxHistoryItemsInput);
  const imageAutoDownloadLabel =
    imageAutoDownloadOptions.find((o) => o.value === attachmentAutoDownload)?.label ??
    t('autoDownload.wifi');
  const imageAutoDownloadNativeState = useNativeState(imageAutoDownloadLabel);

  const handleToggleHistorySync = async (enabled: boolean) => {
    try {
      const { getHistorySyncService } = await import('@/services/HistorySyncService');
      const syncService = getHistorySyncService();
      syncService.cancelAll();
      if (!enabled) {
        await syncService.resetSyncCursor();
      }
    } catch {
      // ignore
    }

    try {
      await useSettingsStore.getState().setEnableHistorySync(enabled);
      if (!enabled) {
        const { runtimeStateStorage } = await import('@/services/RuntimeStateStorage');
        await runtimeStateStorage.update({ needsHistoryReorganize: true });
      }
      showMessage(enabled ? t('history.syncEnabled') : t('history.syncDisabled'), 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('setFailed'), 'error');
    }
  };

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
      const { historyStorage } = await import('@/services');
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
    <SettingsSectionItem title={t('history.sectionTitle')}>
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('history.syncLabel')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>
            {!isSyncClipboard ? t('history.syncUnsupported') : t('history.syncSupported')}
          </ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <ComposeSwitch
            value={historySyncEnabled && isSyncClipboard}
            onCheckedChange={handleToggleHistorySync}
            enabled={isSyncClipboard}
          />
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('history.maxItemsLabel')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>{t('history.maxItemsHint')}</ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <OutlinedTextField
            value={maxHistoryItemsNativeState}
            onValueChange={setMaxHistoryItemsInput}
            onFocusChanged={onMaxHistoryItemsFocusChanged}
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

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('history.autoDownloadLabel')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <ExposedDropdownMenuBox
            expanded={showImageAutoDownloadMenu}
            onExpandedChange={setShowImageAutoDownloadMenu}
            modifiers={[widthModifier(140)]}
          >
            <OutlinedTextField
              key={attachmentAutoDownload}
              value={imageAutoDownloadNativeState}
              readOnly
              singleLine
              modifiers={[menuAnchor(), fillMaxWidth()]}
            />
            <ExposedDropdownMenu
              expanded={showImageAutoDownloadMenu}
              onDismissRequest={() => setShowImageAutoDownloadMenu(false)}
            >
              {imageAutoDownloadOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => {
                    handleImageAutoDownloadChange(option.value);
                    setShowImageAutoDownloadMenu(false);
                  }}
                >
                  <DropdownMenuItem.Text>
                    <ComposeText>{option.label}</ComposeText>
                  </DropdownMenuItem.Text>
                </DropdownMenuItem>
              ))}
            </ExposedDropdownMenu>
          </ExposedDropdownMenuBox>
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('history.showCopyButtonLabel')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>{t('history.showCopyButtonHint')}</ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <ComposeSwitch
            value={showImageCopyButton}
            onCheckedChange={(enabled) =>
              useSettingsStore.getState().updateConfig({ showImageCopyButton: enabled })
            }
          />
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
