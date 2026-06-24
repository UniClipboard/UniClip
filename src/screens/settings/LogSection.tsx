/**
 * 日志 section
 *
 * 日志等级下拉（订阅 config.logLevel）与导出日志。导出按钮在存储计算中时禁用，
 * isCalculating 来自共享的 storageSizes store。
 */
import React, { memo, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import {
  Host,
  Card,
  Column,
  ListItem,
  Button,
  OutlinedTextField,
  ExposedDropdownMenuBox,
  ExposedDropdownMenu,
  DropdownMenuItem,
  HorizontalDivider,
  Text as ComposeText,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  width as widthModifier,
  menuAnchor,
} from '@expo/ui/jetpack-compose/modifiers';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores';
import { saveLogsToFile, setLogLevel as setLoggerLogLevel, type LogLevel } from '@/services';
import { useSettingsToast } from './SettingsToastContext';
import { settingsStyles as styles } from './settingsStyles';
import { useStorageSizesStore } from './storageSizes';

const logLevelOptions: { label: string; value: LogLevel }[] = [
  { label: '调试', value: 'debug' },
  { label: '信息', value: 'info' },
  { label: '警告', value: 'warn' },
  { label: '错误', value: 'error' },
];

export const LogSection = memo(function LogSection() {
  const { theme } = useTheme();
  const showMessage = useSettingsToast();

  const logLevel = useSettingsStore((s) => s.config?.logLevel);
  const isCalculating = useStorageSizesStore((s) => s.isCalculating);

  const [showLogLevelMenu, setShowLogLevelMenu] = useState(false);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const exportLogsAbortControllerRef = useRef<AbortController | null>(null);

  const logLevelLabel = logLevelOptions.find((o) => o.value === logLevel)?.label ?? '错误';
  const logLevelNativeState = useNativeState(logLevelLabel);

  const handleSetLogLevel = async (level: LogLevel) => {
    try {
      await useSettingsStore.getState().setLogLevel(level);
      setLoggerLogLevel(level);
      showMessage(`日志等级已设置为 ${level}`, 'success');
    } catch {
      showMessage('设置日志等级失败', 'error');
    }
  };

  const handleExportLogs = async () => {
    if (isExportingLogs) {
      exportLogsAbortControllerRef.current?.abort();
      return;
    }

    const abortController = new AbortController();
    exportLogsAbortControllerRef.current = abortController;
    setIsExportingLogs(true);

    try {
      await saveLogsToFile(abortController.signal);
      showMessage('日志已保存', 'success');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        showMessage('已取消导出', 'info');
      } else {
        showMessage(error instanceof Error ? error.message : '导出日志失败', 'error');
      }
    } finally {
      setIsExportingLogs(false);
      exportLogsAbortControllerRef.current = null;
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderBase}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>日志</Text>
      </View>

      <Host matchContents={{ vertical: true }} style={styles.hostFill}>
        <Card colors={{ containerColor: theme.colors.surface }}>
          <Column modifiers={[fillMaxWidth()]}>
            <ListItem colors={{ containerColor: theme.colors.surface }}>
              <ListItem.HeadlineContent>
                <ComposeText color={theme.colors.text}>日志等级</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.TrailingContent>
                <ExposedDropdownMenuBox
                  expanded={showLogLevelMenu}
                  onExpandedChange={setShowLogLevelMenu}
                  modifiers={[widthModifier(140)]}
                >
                  <OutlinedTextField
                    key={logLevel ?? 'error'}
                    value={logLevelNativeState}
                    readOnly
                    singleLine
                    modifiers={[menuAnchor(), fillMaxWidth()]}
                  />
                  <ExposedDropdownMenu
                    expanded={showLogLevelMenu}
                    onDismissRequest={() => setShowLogLevelMenu(false)}
                  >
                    {logLevelOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => {
                          handleSetLogLevel(option.value);
                          setShowLogLevelMenu(false);
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

            <HorizontalDivider color={theme.colors.divider} />

            <ListItem colors={{ containerColor: theme.colors.surface }}>
              <ListItem.HeadlineContent>
                <ComposeText color={theme.colors.text}>导出日志</ComposeText>
              </ListItem.HeadlineContent>
              <ListItem.TrailingContent>
                <Button
                  onClick={handleExportLogs}
                  enabled={!isCalculating}
                  colors={{
                    containerColor: theme.colors.primary,
                    contentColor: theme.colors.white,
                  }}
                >
                  <ComposeText>{isExportingLogs ? '取消' : '导出'}</ComposeText>
                </Button>
              </ListItem.TrailingContent>
            </ListItem>
          </Column>
        </Card>
      </Host>
    </View>
  );
});
