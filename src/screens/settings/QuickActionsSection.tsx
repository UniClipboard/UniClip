/**
 * 快捷操作 section
 *
 * 纯动作型 section:不订阅 config,仅调用 ShortcutService。
 * 作为 LazyColumn 的单个 item:无独立 <Host>,内容由父级单 Host 统一组合。
 */
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListItem, Button, HorizontalDivider, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { ShortcutService } from '@/services';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';

export const QuickActionsSection = memo(function QuickActionsSection() {
  const { t } = useTranslation('settingsPermissions');
  const showMessage = useSettingsToast();

  const handleAddDownloadShortcut = async () => {
    try {
      await ShortcutService.addDownloadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('quickActions.addFailed'), 'error');
    }
  };

  const handleAddUploadShortcut = async () => {
    try {
      await ShortcutService.addUploadShortcut();
    } catch (error: unknown) {
      showMessage(error instanceof Error ? error.message : t('quickActions.addFailed'), 'error');
    }
  };

  return (
    <SettingsSectionItem title={t('quickActions.title')}>
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('quickActions.addDownloadShortcut')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <Button onClick={handleAddDownloadShortcut}>
            <ComposeText>{t('action.add', { ns: 'common' })}</ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('quickActions.addUploadShortcut')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <Button onClick={handleAddUploadShortcut}>
            <ComposeText>{t('action.add', { ns: 'common' })}</ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
