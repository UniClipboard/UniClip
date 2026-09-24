/**
 * 存储 section
 *
 * 顶部概览卡片:总占用 + 历史 / 缓存 / 日志的比例条;其下 grouped 分组逐项列出占用,缓存与
 * 日志行整行点击即弹出清理确认。占用数据来自共享的 storageSizes store;清理后调用
 * recalculate 统一刷新。作为 item:无独立 Host,两个确认弹窗作为 item 内 overlay 渲染
 * (见 SettingsSectionItem.dialogs)。手动刷新入口在二级页 navigator 的 headerRight。
 */
import React, { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  Box,
  Column,
  Row,
  Spacer,
  TextButton,
  Text as ComposeText,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  background,
  clip,
  fillMaxHeight,
  fillMaxWidth,
  height as heightModifier,
  Shapes,
  size,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { clearDirectory, CLIPBOARD_TEMP_DIR } from '@/platform/files';
import { clearLogs } from '@/support/observability';
import { useSettingsToast } from './SettingsToastContext';
import { SettingsSectionItem } from './SettingsSectionItem';
import { SettingsHeroCard } from './android/SettingsHeroCard';
import { SettingsListRow } from './android/SettingsListRow';
import { useStorageSizesStore } from './storageSizes';

const ICONS = {
  history: require('../../assets/icons/history.xml'),
  cache: require('../../assets/icons/storage.xml'),
  logs: require('../../assets/icons/description.xml'),
};

const TOTAL_STYLE = { typography: 'headlineMedium' } as const;
const LEGEND_STYLE = { typography: 'labelMedium' } as const;
const BAR_HEIGHT = 12;
const BAR_GAP = 3;

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

interface UsageSegment {
  key: 'history' | 'cache' | 'logs';
  bytes: number;
  color: string;
}

/** 总占用 + 比例条 + 图例。计算中或全为 0 时比例条只显示空轨道。 */
function StorageOverviewCard({
  segments,
  isCalculating,
}: {
  segments: UsageSegment[];
  isCalculating: boolean;
}) {
  const { t } = useTranslation('settingsStorage');
  const colors = useMaterialColors();
  const total = segments.reduce((sum, segment) => sum + segment.bytes, 0);
  // Compose weight 必须 > 0:只画有占用的段
  const visible = isCalculating ? [] : segments.filter((segment) => segment.bytes > 0);

  return (
    <SettingsHeroCard>
      <Column>
        <ComposeText style={TOTAL_STYLE}>
          {isCalculating ? t('state.loading', { ns: 'common' }) : formatFileSize(total)}
        </ComposeText>
        <ComposeText color={colors.onSurfaceVariant}>{t('overview.totalLabel')}</ComposeText>
      </Column>
      <Row
        horizontalArrangement={{ spacedBy: BAR_GAP }}
        modifiers={[
          fillMaxWidth(),
          heightModifier(BAR_HEIGHT),
          clip(Shapes.RoundedCorner(BAR_HEIGHT / 2)),
          ...(visible.length === 0 ? [background(colors.surfaceContainerHighest)] : []),
        ]}
      >
        {visible.map((segment) => (
          <Box
            key={segment.key}
            modifiers={[weight(segment.bytes / total), fillMaxHeight(), background(segment.color)]}
          />
        ))}
      </Row>
      <Row horizontalArrangement={{ spacedBy: 16 }}>
        {segments.map((segment) => (
          <Row key={segment.key} verticalAlignment="center">
            <Box modifiers={[size(8, 8), clip(Shapes.Circle), background(segment.color)]} />
            <Spacer modifiers={[size(6, 1)]} />
            <ComposeText color={colors.onSurfaceVariant} style={LEGEND_STYLE}>
              {t(`kind.${segment.key}`)}
            </ComposeText>
          </Row>
        ))}
      </Row>
    </SettingsHeroCard>
  );
}

export const StorageSection = memo(function StorageSection() {
  const { t } = useTranslation('settingsStorage');
  const showMessage = useSettingsToast();
  const colors = useMaterialColors();

  const cacheSize = useStorageSizesStore((s) => s.cacheSize);
  const historySize = useStorageSizesStore((s) => s.historySize);
  const logSize = useStorageSizesStore((s) => s.logSize);
  const isCalculating = useStorageSizesStore((s) => s.isCalculating);
  const recalculate = useStorageSizesStore((s) => s.recalculate);

  const [showClearCacheDialog, setShowClearCacheDialog] = useState(false);
  const [showClearLogsDialog, setShowClearLogsDialog] = useState(false);

  useEffect(() => {
    recalculate();
  }, [recalculate]);

  const handleClearCacheConfirm = async () => {
    try {
      clearDirectory(CLIPBOARD_TEMP_DIR);
      await recalculate();
      showMessage(t('cache.cleared'), 'success');
    } catch {
      showMessage(t('cache.clearFailed'), 'error');
    }
  };

  const handleClearLogsConfirm = async () => {
    try {
      clearLogs();
      await recalculate();
      showMessage(t('log.cleared'), 'success');
    } catch {
      showMessage(t('log.clearFailed'), 'error');
    }
  };

  const sizeLabel = (bytes: number) =>
    isCalculating ? t('state.loading', { ns: 'common' }) : formatFileSize(bytes);
  const segments: UsageSegment[] = [
    { key: 'history', bytes: historySize, color: colors.primary },
    { key: 'cache', bytes: cacheSize, color: colors.tertiary },
    { key: 'logs', bytes: logSize, color: colors.outline },
  ];

  return (
    <Column modifiers={[fillMaxWidth()]}>
      <StorageOverviewCard segments={segments} isCalculating={isCalculating} />
      <Spacer modifiers={[heightModifier(24)]} />
      <SettingsSectionItem
        variant="grouped"
        title={t('overview.usageTitle')}
        dialogs={
          <>
            {showClearCacheDialog && (
              <AlertDialog onDismissRequest={() => setShowClearCacheDialog(false)}>
                <AlertDialog.Title>
                  <ComposeText>{t('cache.clearDialogTitle')}</ComposeText>
                </AlertDialog.Title>
                <AlertDialog.Text>
                  <ComposeText>{t('cache.clearDialogMessage')}</ComposeText>
                </AlertDialog.Text>
                <AlertDialog.ConfirmButton>
                  <TextButton
                    onClick={() => {
                      handleClearCacheConfirm();
                      setShowClearCacheDialog(false);
                    }}
                  >
                    <ComposeText>{t('action.confirm', { ns: 'common' })}</ComposeText>
                  </TextButton>
                </AlertDialog.ConfirmButton>
                <AlertDialog.DismissButton>
                  <TextButton onClick={() => setShowClearCacheDialog(false)}>
                    <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
                  </TextButton>
                </AlertDialog.DismissButton>
              </AlertDialog>
            )}

            {showClearLogsDialog && (
              <AlertDialog onDismissRequest={() => setShowClearLogsDialog(false)}>
                <AlertDialog.Title>
                  <ComposeText>{t('log.clearDialogTitle')}</ComposeText>
                </AlertDialog.Title>
                <AlertDialog.Text>
                  <ComposeText>{t('log.clearDialogMessage')}</ComposeText>
                </AlertDialog.Text>
                <AlertDialog.ConfirmButton>
                  <TextButton
                    onClick={() => {
                      handleClearLogsConfirm();
                      setShowClearLogsDialog(false);
                    }}
                  >
                    <ComposeText>{t('action.confirm', { ns: 'common' })}</ComposeText>
                  </TextButton>
                </AlertDialog.ConfirmButton>
                <AlertDialog.DismissButton>
                  <TextButton onClick={() => setShowClearLogsDialog(false)}>
                    <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
                  </TextButton>
                </AlertDialog.DismissButton>
              </AlertDialog>
            )}
          </>
        }
      >
        <SettingsListRow
          key="history"
          icon={ICONS.history}
          title={t('kind.history')}
          description={sizeLabel(historySize)}
        />
        <SettingsListRow
          key="cache"
          testID="storage-clear-cache"
          icon={ICONS.cache}
          title={t('kind.cache')}
          description={sizeLabel(cacheSize)}
          trailing={{ action: t('cleanUp') }}
          disabled={isCalculating}
          onPress={() => setShowClearCacheDialog(true)}
        />
        <SettingsListRow
          key="logs"
          testID="storage-clear-logs"
          icon={ICONS.logs}
          title={t('kind.logs')}
          description={sizeLabel(logSize)}
          trailing={{ action: t('cleanUp') }}
          disabled={isCalculating}
          onPress={() => setShowClearLogsDialog(true)}
        />
      </SettingsSectionItem>
    </Column>
  );
});
