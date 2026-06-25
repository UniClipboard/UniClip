/**
 * 历史记录 section
 *
 * 订阅 enableHistorySync / attachmentAutoDownload / showImageCopyButton 及当前服务器类型。
 */
import React, { memo, useState } from 'react';
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
import { SettingsSectionItem } from './SettingsSectionItem';

type ImageAutoDownload = 'wifi' | 'always' | 'off';
const imageAutoDownloadOptions: { label: string; value: ImageAutoDownload }[] = [
  { label: '仅 Wi-Fi', value: 'wifi' },
  { label: '总是', value: 'always' },
  { label: '关闭', value: 'off' },
];

export const HistorySection = memo(function HistorySection() {
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

  const maxHistoryItemsNativeState = useNativeState(maxHistoryItemsInput);
  const imageAutoDownloadLabel =
    imageAutoDownloadOptions.find((o) => o.value === attachmentAutoDownload)?.label ?? '仅 Wi-Fi';
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
      showMessage(enabled ? '已启用历史记录同步' : '已禁用历史记录同步', 'success');
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
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
        showMessage('请输入大于等于10的数字', 'error');
        return;
      }
      await useSettingsStore.getState().updateConfig({ maxHistoryItems: maxItems });
      showMessage(`已设置历史记录最大保留条数为 ${maxItems}条`, 'success');
      const { historyStorage } = await import('@/services');
      historyStorage.setMaxHistorySize(maxItems);
    } catch (error: unknown) {
      resetToCurrent();
      showMessage(error instanceof Error ? error.message : '设置失败', 'error');
    }
  };

  const handleImageAutoDownloadChange = async (value: ImageAutoDownload) => {
    try {
      await useSettingsStore.getState().updateConfig({ attachmentAutoDownload: value });
    } catch {
      // store 失败回滚 config，下拉显示自动恢复
    }
  };

  return (
    <SettingsSectionItem title="历史记录">
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>历史记录同步</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>
            {!isSyncClipboard ? '当前服务器不支持历史记录同步' : '同步历史记录到服务器'}
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
          <ComposeText>历史记录最大保留条数</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>最小值为10条</ComposeText>
        </ListItem.SupportingContent>
        <ListItem.TrailingContent>
          <OutlinedTextField
            value={maxHistoryItemsNativeState}
            onValueChange={setMaxHistoryItemsInput}
            onFocusChanged={(focused) => {
              if (!focused) handleMaxHistoryItemsBlur();
            }}
            keyboardOptions={{ keyboardType: 'number' }}
            singleLine
            modifiers={[widthModifier(112)]}
          >
            <OutlinedTextField.Placeholder>
              <ComposeText>100</ComposeText>
            </OutlinedTextField.Placeholder>
            <OutlinedTextField.Suffix>
              <ComposeText>条</ComposeText>
            </OutlinedTextField.Suffix>
          </OutlinedTextField>
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>浏览到图片时自动下载</ComposeText>
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
          <ComposeText>为图片显示复制按钮</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.SupportingContent>
          <ComposeText>在历史记录的图片项显示复制到剪贴板按钮</ComposeText>
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
