/**
 * 日志 section
 *
 * 日志等级下拉（订阅 config.logLevel）与导出日志。导出按钮在存储计算中时禁用，
 * isCalculating 来自共享的 storageSizes store。
 */
import React, { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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
import { useSettingsStore } from '@/stores';
import { saveLogsToFile, setLogLevel as setLoggerLogLevel, type LogLevel } from '@/services';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';
import { useStorageSizesStore } from './storageSizes';

export const LogSection = memo(function LogSection() {
  const { t } = useTranslation('settingsAbout');
  const showMessage = useSettingsToast();

  const logLevel = useSettingsStore((s) => s.config?.logLevel);
  const isCalculating = useStorageSizesStore((s) => s.isCalculating);

  const [showLogLevelMenu, setShowLogLevelMenu] = useState(false);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const exportLogsAbortControllerRef = useRef<AbortController | null>(null);

  const logLevelOptions: { label: string; value: LogLevel }[] = [
    { label: t('log.level.debug'), value: 'debug' },
    { label: t('log.level.info'), value: 'info' },
    { label: t('log.level.warn'), value: 'warn' },
    { label: t('log.level.error'), value: 'error' },
  ];

  const logLevelLabel =
    logLevelOptions.find((o) => o.value === logLevel)?.label ?? t('log.level.error');
  const logLevelNativeState = useNativeState(logLevelLabel);

  const handleSetLogLevel = async (level: LogLevel) => {
    try {
      await useSettingsStore.getState().setLogLevel(level);
      setLoggerLogLevel(level);
      showMessage(t('log.setSuccess', { level }), 'success');
    } catch {
      showMessage(t('log.setFailed'), 'error');
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
      showMessage(t('log.exported'), 'success');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        showMessage(t('log.exportCanceled'), 'info');
      } else {
        showMessage(error instanceof Error ? error.message : t('log.exportFailed'), 'error');
      }
    } finally {
      setIsExportingLogs(false);
      exportLogsAbortControllerRef.current = null;
    }
  };

  return (
    <SettingsSectionItem title={t('log.title')}>
      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('log.levelLabel')}</ComposeText>
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

      <HorizontalDivider />

      <ListItem>
        <ListItem.HeadlineContent>
          <ComposeText>{t('log.exportLabel')}</ComposeText>
        </ListItem.HeadlineContent>
        <ListItem.TrailingContent>
          <Button onClick={handleExportLogs} enabled={!isCalculating}>
            <ComposeText>
              {isExportingLogs ? t('action.cancel', { ns: 'common' }) : t('log.export')}
            </ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
