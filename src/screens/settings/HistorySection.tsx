/**
 * 历史记录 section
 *
 * 订阅 attachmentAutoDownload / showImageCopyButton。
 */
import React, { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListItem,
  OutlinedTextField,
  Text as ComposeText,
  useNativeState,
  type ObservableState,
} from '@expo/ui/jetpack-compose';
import { width as widthModifier } from '@expo/ui/jetpack-compose/modifiers';
import { useSettingsStore } from '@/stores';
import { useSettingsToast } from './SettingsToastContext';
import { useBlurCommit } from './useBlurCommit';
import { SettingsSectionItem, useSettingsSectionRowColors } from './SettingsSectionItem';
import { SettingsSelectRow } from './android/SettingsSelectRow';
import { SettingsSwitchRow } from './android/SettingsSwitchRow';

type ImageAutoDownload = 'wifi' | 'always' | 'off';
/** 停止输入多久后自动保存;避免输入 "250" 途中把 "25" 当成最终值。 */
const MAX_ITEMS_COMMIT_DELAY_MS = 800;
const IMAGE_AUTO_DOWNLOAD_VALUES: ImageAutoDownload[] = ['wifi', 'always', 'off'];

/** 输入型行:交互就是行尾的数字输入框,行本身不可点;容器色需在分组上下文内读取。 */
function MaxHistoryItemsRow({
  value,
  onValueChange,
  onFocusChanged,
}: {
  value: ObservableState<string>;
  onValueChange: (value: string) => void;
  onFocusChanged: (focused: boolean) => void;
}) {
  const { t } = useTranslation('settingsStorage');
  const rowColors = useSettingsSectionRowColors();
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
          value={value}
          onValueChange={onValueChange}
          onFocusChanged={onFocusChanged}
          keyboardOptions={{ keyboardType: 'number' }}
          singleLine
          modifiers={[widthModifier(120)]}
        >
          <OutlinedTextField.Placeholder>
            <ComposeText>100</ComposeText>
          </OutlinedTextField.Placeholder>
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

  const currentMaxItems = () => useSettingsStore.getState().config?.maxHistoryItems ?? 1000;
  const maxHistoryItemsInput = useNativeState(currentMaxItems().toString());
  // null 表示用户还没改过输入框。
  const draftRef = useRef<string | null>(null);

  const imageAutoDownloadOptions = IMAGE_AUTO_DOWNLOAD_VALUES.map((value) => ({
    value,
    label: t(`autoDownload.${value}`),
  }));

  const mountedRef = useRef(true);

  // announce=false 用于自动保存与离开页面时的静默提交,不弹 toast。
  const commitMaxHistoryItems = async (announce: boolean) => {
    const draft = draftRef.current;
    if (draft === null || draft === currentMaxItems().toString()) return;
    const resetToCurrent = () => {
      if (!mountedRef.current) return;
      draftRef.current = currentMaxItems().toString();
      maxHistoryItemsInput.set(draftRef.current);
    };
    const maxItems = /^\d+$/.test(draft) ? parseInt(draft, 10) : NaN;
    if (isNaN(maxItems) || maxItems < 10) {
      // 自动保存时用户可能还在输入(如先打 5 再打 0),只有真正失焦才还原。
      if (announce) {
        resetToCurrent();
        showMessage(t('history.maxItemsInvalid'), 'error');
      }
      return;
    }
    const result = await useSettingsStore.getState().updateConfig({ maxHistoryItems: maxItems });
    if (!result.ok) {
      resetToCurrent();
      if (announce) showMessage(result.error || t('setFailed'), 'error');
      return;
    }
    const { historyStorage } = await import('@/features/history');
    historyStorage.setMaxHistorySize(maxItems);
  };

  // Compose 输入框收起键盘或点返回都不会失焦,只靠失焦提交会丢值:
  // 停止输入后自动提交有效值,离开页面时再补交一次;无效值只在真正失焦时提示并还原。
  const commitRef = useRef(commitMaxHistoryItems);
  useEffect(() => {
    commitRef.current = commitMaxHistoryItems;
  });
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleDraftChange = (text: string) => {
    draftRef.current = text;
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(
      () => void commitRef.current(false),
      MAX_ITEMS_COMMIT_DELAY_MS
    );
  };
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      void commitRef.current(false);
    };
  }, []);

  const onMaxHistoryItemsFocusChanged = useBlurCommit(() => void commitRef.current(true));

  const handleImageAutoDownloadChange = async (value: ImageAutoDownload) => {
    try {
      await useSettingsStore.getState().updateConfig({ attachmentAutoDownload: value });
    } catch {
      // store 失败回滚 config，下拉显示自动恢复
    }
  };

  return (
    <SettingsSectionItem variant="grouped">
      <MaxHistoryItemsRow
        key="maxItems"
        value={maxHistoryItemsInput}
        onValueChange={handleDraftChange}
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
