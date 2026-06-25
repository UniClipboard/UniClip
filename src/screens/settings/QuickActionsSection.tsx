/**
 * 快捷操作 section
 *
 * 纯动作型 section:不订阅 config,仅调用 ShortcutService。
 * 作为 LazyColumn 的单个 item:无独立 <Host>,内容由父级单 Host 统一组合。
 */
import React, { memo } from 'react';
import { ListItem, Button, HorizontalDivider, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { ShortcutService } from '@/services';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';

export const QuickActionsSection = memo(function QuickActionsSection() {
  const showMessage = useSettingsToast();

  const handleAddDownloadShortcut = async () => {
    try {
      await ShortcutService.addDownloadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '添加失败', 'error');
    }
  };

  const handleAddUploadShortcut = async () => {
    try {
      await ShortcutService.addUploadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : '添加失败', 'error');
    }
  };

  return (
    <SettingsSectionItem title="快捷操作">
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>添加桌面快捷方式：下载</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <Button onClick={handleAddDownloadShortcut}>
            <ComposeText>添加</ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>添加桌面快捷方式：上传</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <Button onClick={handleAddUploadShortcut}>
            <ComposeText>添加</ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
