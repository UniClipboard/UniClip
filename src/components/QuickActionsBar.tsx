/**
 * Quick Actions Bar Component
 * 快速操作栏 - 底部悬浮操作按钮
 */

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Host,
  FilledTonalButton,
  CircularProgressIndicator,
  Row,
  Text as ComposeText,
} from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { useTheme } from '@/hooks/useTheme';
import { spacing } from '@/theme';

interface QuickActionsBarProps {
  onUpload: () => void;
  onDownload: () => void;
  onSync: () => void;
  disabled?: boolean;
  syncInProgress?: boolean;
}

export const QuickActionsBar: React.FC<QuickActionsBarProps> = ({
  onUpload,
  onDownload,
  onSync,
  disabled = false,
  syncInProgress = false,
}) => {
  const { t } = useTranslation('home');
  const { theme } = useTheme();

  const actionDisabled = disabled || syncInProgress;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      {/* 上传按钮 — Filled Tonal */}
      <Host matchContents style={styles.buttonHost}>
        <FilledTonalButton
          onClick={onUpload}
          enabled={!actionDisabled}
          modifiers={[fillMaxWidth()]}
          colors={{
            containerColor: theme.colors.surfaceHigh,
            contentColor: theme.colors.textPrimary,
          }}
        >
          <ComposeText>{t('quickActions.upload')}</ComposeText>
        </FilledTonalButton>
      </Host>

      {/* 同步按钮 (主操作) — M3 Filled Tonal 主色 */}
      <Host matchContents style={styles.syncButtonHost}>
        <FilledTonalButton
          onClick={onSync}
          enabled={!actionDisabled}
          modifiers={[fillMaxWidth()]}
          colors={{
            containerColor: theme.colors.accentContainer,
            contentColor: theme.colors.onAccentContainer,
          }}
        >
          <Row verticalAlignment="center" horizontalArrangement="center">
            {syncInProgress && <CircularProgressIndicator color={theme.colors.onAccentContainer} />}
            <ComposeText>
              {syncInProgress ? t('quickActions.syncing') : t('quickActions.sync')}
            </ComposeText>
          </Row>
        </FilledTonalButton>
      </Host>

      {/* 下载按钮 — Filled Tonal */}
      <Host matchContents style={styles.buttonHost}>
        <FilledTonalButton
          onClick={onDownload}
          enabled={!actionDisabled}
          modifiers={[fillMaxWidth()]}
          colors={{
            containerColor: theme.colors.surfaceHigh,
            contentColor: theme.colors.textPrimary,
          }}
        >
          <ComposeText>{t('quickActions.download')}</ComposeText>
        </FilledTonalButton>
      </Host>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
  },
  buttonHost: {
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  syncButtonHost: {
    flex: 1.5,
    marginHorizontal: spacing.sm,
  },
});
