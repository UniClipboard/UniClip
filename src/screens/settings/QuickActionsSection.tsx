/**
 * 快捷操作 section
 *
 * 纯动作型 section：不订阅 config，仅调用 ShortcutService。
 */
import React, { memo } from 'react';
import { View, Text } from 'react-native';
import {
  Host,
  Card,
  Column,
  ListItem,
  Button,
  HorizontalDivider,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { useTheme } from '@/hooks/useTheme';
import { ShortcutService } from '@/services';
import { useSettingsToast } from './SettingsToastContext';
import { settingsStyles as styles } from './settingsStyles';

export const QuickActionsSection = memo(function QuickActionsSection() {
  const { theme } = useTheme();
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

  const buttonColors = {
    containerColor: theme.colors.primary,
    contentColor: theme.colors.white,
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderBase}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>快捷操作</Text>
      </View>

      <Host matchContents={{ vertical: true }} style={styles.hostFill}>
        <Card colors={{ containerColor: theme.colors.surface }}>
          <Column modifiers={[fillMaxWidth()]}>
            <ListItem colors={{ containerColor: theme.colors.surface }}>
              <ListItem.HeadlineContent>
                <ComposeText color={theme.colors.text}>添加桌面快捷方式：下载</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.TrailingContent>
                <Button onClick={handleAddDownloadShortcut} colors={buttonColors}>
                  <ComposeText>添加</ComposeText>
                </Button>
              </ListItem.TrailingContent>
            </ListItem>

            <HorizontalDivider color={theme.colors.divider} />

            <ListItem colors={{ containerColor: theme.colors.surface }}>
              <ListItem.HeadlineContent>
                <ComposeText color={theme.colors.text}>添加桌面快捷方式：上传</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.TrailingContent>
                <Button onClick={handleAddUploadShortcut} colors={buttonColors}>
                  <ComposeText>添加</ComposeText>
                </Button>
              </ListItem.TrailingContent>
            </ListItem>
          </Column>
        </Card>
      </Host>
    </View>
  );
});
