/**
 * 日志 section
 *
 * 日志等级下拉（订阅 config.logLevel）与导出日志。
 */
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListItem,
  Button,
  OutlinedTextField,
  ExposedDropdownMenuBox,
  ExposedDropdownMenu,
  DropdownMenuItem,
  HorizontalDivider,
  AlertDialog,
  TextButton,
  Text as ComposeText,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  width as widthModifier,
  menuAnchor,
} from '@expo/ui/jetpack-compose/modifiers';
import { useSettingsStore } from '@/stores';
import {
  createLogArchive,
  deleteExportedLogArchive,
  saveLogsToFile,
  scheduleExportedLogArchiveCleanup,
  setLogLevel as setLoggerLogLevel,
  type ExportedLogArchive,
  type LogLevel,
} from '@/services';
import { shareFile } from '@/utils/fileActions';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';

function LogLevelField({ label }: { label: string }) {
  const nativeLabel = useNativeState(label);

  return (
    <OutlinedTextField
      value={nativeLabel}
      readOnly
      singleLine
      modifiers={[menuAnchor(), fillMaxWidth()]}
    />
  );
}

export const LogSection = memo(function LogSection() {
  const { t } = useTranslation('settingsAbout');
  const showMessage = useSettingsToast();

  const logLevel = useSettingsStore((s) => s.config?.logLevel);

  const [showLogLevelMenu, setShowLogLevelMenu] = useState(false);
  const [showExportMethodDialog, setShowExportMethodDialog] = useState(false);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const exportLogsAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => exportLogsAbortControllerRef.current?.abort(), []);

  const logLevelOptions: { label: string; value: LogLevel }[] = [
    { label: t('log.level.debug'), value: 'debug' },
    { label: t('log.level.info'), value: 'info' },
    { label: t('log.level.warn'), value: 'warn' },
    { label: t('log.level.error'), value: 'error' },
  ];

  const logLevelLabel =
    logLevelOptions.find((o) => o.value === logLevel)?.label ?? t('log.level.error');

  const handleSetLogLevel = async (level: LogLevel) => {
    try {
      await useSettingsStore.getState().setLogLevel(level);
      setLoggerLogLevel(level);
      showMessage(t('log.setSuccess', { level }), 'success');
    } catch {
      showMessage(t('log.setFailed'), 'error');
    }
  };

  const beginExportOperation = () => {
    const abortController = new AbortController();
    exportLogsAbortControllerRef.current = abortController;
    setIsExportingLogs(true);
    return abortController;
  };

  const finishExportOperation = () => {
    setIsExportingLogs(false);
    exportLogsAbortControllerRef.current = null;
  };

  const handleShareLogs = async () => {
    setShowExportMethodDialog(false);
    const abortController = beginExportOperation();
    let archive: ExportedLogArchive | null = null;

    try {
      archive = await createLogArchive(abortController.signal);
      await shareFile(archive.uri, archive.fileName);
      scheduleExportedLogArchiveCleanup(archive.uri);
    } catch (error) {
      if (archive) {
        deleteExportedLogArchive(archive.uri);
      }
      if (error instanceof Error && error.name === 'AbortError') {
        showMessage(t('log.exportCanceled'), 'info');
      } else {
        showMessage(error instanceof Error ? error.message : t('log.shareFailed'), 'error');
      }
    } finally {
      finishExportOperation();
    }
  };

  const handleSaveLogsToFile = async () => {
    setShowExportMethodDialog(false);
    const abortController = beginExportOperation();

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
      finishExportOperation();
    }
  };

  const handleExportButtonClick = () => {
    if (isExportingLogs) {
      exportLogsAbortControllerRef.current?.abort();
    } else {
      setShowExportMethodDialog(true);
    }
  };

  return (
    <SettingsSectionItem
      title={t('log.title')}
      dialogs={
        showExportMethodDialog ? (
          <AlertDialog onDismissRequest={() => setShowExportMethodDialog(false)}>
            <AlertDialog.Title>
              <ComposeText>{t('log.exportLabel')}</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText>{t('log.exportMethodPrompt')}</ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton onClick={handleShareLogs}>
                <ComposeText>{t('action.share', { ns: 'common' })}</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={handleSaveLogsToFile}>
                <ComposeText>{t('log.exportFile')}</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        ) : null
      }
    >
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
            <LogLevelField key={logLevelLabel} label={logLevelLabel} />
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
          <Button onClick={handleExportButtonClick}>
            <ComposeText>
              {isExportingLogs ? t('action.cancel', { ns: 'common' }) : t('log.export')}
            </ComposeText>
          </Button>
        </ListItem.TrailingContent>
      </ListItem>
    </SettingsSectionItem>
  );
});
