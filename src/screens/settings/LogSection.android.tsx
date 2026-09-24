/**
 * 诊断日志二级页(Android)
 *
 * 顶部「详细记录」卡片:一次最长 10 分钟、到时自动结束的临时操作,用按钮而非开关表达,
 * 记录中卡片切到 primaryContainer 并显示剩余时间。其下 grouped 分组放导出日志与日志等级。
 * 日志文件的占用与清理仍在「存储」页,这里只用脚注指过去。
 */
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  Button,
  Column,
  OutlinedButton,
  Row,
  Spacer,
  TextButton,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height as heightModifier,
  testID,
  width as widthModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { useEngineDiagnosticCapture } from '@/support/diagnostics/useEngineDiagnosticCapture';
import { useSettingsStore, useUnifiedEngineStore } from '@/stores';
import { setLogLevel as setLoggerLogLevel, type LogLevel } from '@/support/observability';
import {
  classifyDiagnosticReason,
  createDiagnosticArchive,
  deleteDiagnosticArchive,
  scheduleDiagnosticArchiveCleanup,
  type DiagnosticArtifact,
} from '@/support/diagnostics';
import { useUnifiedSpaceStore } from '@/features/space';
import { saveFile, shareFile } from '@/utils/fileActions';
import type { LogSectionProps } from './LogSection.types';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';
import { SettingsHeroCard } from './android/SettingsHeroCard';
import { SettingsLeadingIcon } from './android/SettingsLeadingIcon';
import { SettingsListRow } from './android/SettingsListRow';
import { SettingsSelectRow } from './android/SettingsSelectRow';

const RECORD_ICON = require('../../assets/icons/fiber_manual_record.xml');
const CARD_TITLE_STYLE = { typography: 'titleLarge' } as const;

type DiagnosticCapture = ReturnType<typeof useEngineDiagnosticCapture>;

/** 详细记录卡片:状态 + 说明 + 开始 / 停止按钮(testID 供 Maestro 定位)。 */
function DiagnosticCaptureCard({ capture }: { capture: DiagnosticCapture }) {
  const { t } = useTranslation('settingsAbout');
  const colors = useMaterialColors();
  const enabled = capture.available && !capture.busy;
  const status = capture.failed
    ? t('log.capture.failed')
    : !capture.available
    ? t('log.capture.unavailable')
    : capture.active
    ? t('log.capture.remaining', { count: capture.remainingMinutes })
    : null;
  const toggle = () => void capture.toggle();

  return (
    <SettingsHeroCard tone={capture.active ? 'primary' : 'neutral'}>
      <Row verticalAlignment="center">
        <SettingsLeadingIcon source={RECORD_ICON} tone={capture.active ? 'error' : 'primary'} />
        <Spacer modifiers={[widthModifier(14)]} />
        <ComposeText style={CARD_TITLE_STYLE}>{t('log.capture.title')}</ComposeText>
      </Row>
      {status ? (
        <ComposeText color={capture.active && !capture.failed ? colors.error : undefined}>
          {status}
        </ComposeText>
      ) : null}
      {capture.active ? null : (
        <ComposeText color={colors.onSurfaceVariant}>{t('log.capture.description')}</ComposeText>
      )}
      {capture.active ? (
        <OutlinedButton
          modifiers={[testID('engine-diagnostic-capture')]}
          enabled={enabled}
          onClick={toggle}
        >
          <ComposeText>{t('log.capture.stop')}</ComposeText>
        </OutlinedButton>
      ) : (
        <Button
          modifiers={[testID('engine-diagnostic-capture')]}
          enabled={enabled}
          onClick={toggle}
        >
          <ComposeText>{t('log.capture.start')}</ComposeText>
        </Button>
      )}
    </SettingsHeroCard>
  );
}

export const LogSection = memo(function LogSection(_props: LogSectionProps) {
  const { t } = useTranslation('settingsAbout');
  const capture = useEngineDiagnosticCapture();
  const showMessage = useSettingsToast();

  const config = useSettingsStore((s) => s.config);
  const logLevel = config?.logLevel;
  const engineStatus = useUnifiedEngineStore((state) => state.status);
  const peerConnectionStatus = useUnifiedEngineStore((state) => state.peerConnectionStatus);
  const engineError = useUnifiedEngineStore((state) => state.lastError);
  const spaceId = useUnifiedSpaceStore((state) => state.spaceId);
  const deviceCount = useUnifiedSpaceStore((state) => state.devices.length);

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

  const createArchive = (signal: AbortSignal) => {
    if (!config) throw new Error(t('log.exportFailed'));
    return createDiagnosticArchive(
      {
        settings: {
          autoApplyRemote: config.autoApplyRemote,
          autoPushLocal: config.autoPushLocal,
          attachmentAutoDownload: config.attachmentAutoDownload,
          logLevel: config.logLevel,
        },
        sync: {
          status: engineStatus,
          peerConnectionStatus,
          hasSpace: spaceId !== null,
          deviceCount,
          lastErrorReason: engineError ? classifyDiagnosticReason(engineError) : null,
        },
      },
      undefined,
      signal
    );
  };

  const handleShareLogs = async () => {
    setShowExportMethodDialog(false);
    const abortController = beginExportOperation();
    let archive: DiagnosticArtifact | null = null;

    try {
      archive = await createArchive(abortController.signal);
      await shareFile(archive.uri, archive.fileName);
      scheduleDiagnosticArchiveCleanup(archive.uri);
      archive = null;
    } catch (error) {
      if (archive) {
        deleteDiagnosticArchive(archive.uri);
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
    let archive: DiagnosticArtifact | null = null;

    try {
      archive = await createArchive(abortController.signal);
      const saved = await saveFile(archive.uri, archive.fileName);
      if (!saved) {
        const error = new Error('Diagnostic archive save was canceled');
        error.name = 'AbortError';
        throw error;
      }
      showMessage(t('log.exported'), 'success');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        showMessage(t('log.exportCanceled'), 'info');
      } else {
        showMessage(error instanceof Error ? error.message : t('log.exportFailed'), 'error');
      }
    } finally {
      if (archive) deleteDiagnosticArchive(archive.uri);
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
    <Column modifiers={[fillMaxWidth()]}>
      <DiagnosticCaptureCard capture={capture} />
      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem
        variant="grouped"
        title={t('log.title')}
        footer={t('log.storageHint')}
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
        <SettingsListRow
          key="export"
          testID="diagnostics-export"
          title={t('log.exportLabel')}
          description={t('log.exportDescription')}
          trailing={{
            action: isExportingLogs ? t('action.cancel', { ns: 'common' }) : t('log.export'),
          }}
          onPress={handleExportButtonClick}
        />
        <SettingsSelectRow
          key="logLevel"
          testID="diagnostics-log-level"
          title={t('log.levelLabel')}
          options={logLevelOptions}
          selectedValue={logLevel ?? 'error'}
          onSelect={(level) => void handleSetLogLevel(level)}
        />
      </SettingsSectionItem>
    </Column>
  );
});
