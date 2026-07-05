/**
 * 服务器列表项组件
 * 显示单个服务器配置信息
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Host, AlertDialog, TextButton, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { useTheme } from '@/hooks/useTheme';
import { spacing, radius, typography, alpha } from '@/theme';
import { ServerConfig } from '@/types/api';

interface ServerListItemProps {
  config: ServerConfig;
  isActive: boolean;
  onPress: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export const ServerListItem: React.FC<ServerListItemProps> = ({
  config,
  isActive,
  onPress,
  onEdit,
  onDelete,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation('server');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const getServerDisplayName = (config: ServerConfig): string => {
    if (config.name) return config.name;
    try {
      const url = new URL(config.url);
      return url.hostname;
    } catch {
      return config.url;
    }
  };

  const getServerTypeLabel = (type: string): string => {
    switch (type) {
      case 'syncclipboard':
        return 'SyncClipboard';
      case 's3':
        return 'S3';
      default:
        return 'WebDAV';
    }
  };

  const getTypeBadgeColors = (type: string) => {
    if (type === 'syncclipboard') {
      return {
        backgroundColor: alpha('#4CAF50', 0.16),
        color: theme.isDark ? '#A5D6A7' : '#1B5E20',
      };
    } else if (type === 's3') {
      return {
        backgroundColor: alpha('#2196F3', 0.16),
        color: theme.isDark ? '#90CAF9' : '#0D47A1',
      };
    } else {
      return {
        backgroundColor: alpha('#FF9800', 0.16),
        color: theme.isDark ? '#FFD58A' : '#8C5400',
      };
    }
  };

  return (
    <>
      <TouchableOpacity
        style={[
          styles.container,
          {
            backgroundColor: isActive ? theme.colors.accentContainer : theme.colors.surfaceLow,
          },
          isActive && { borderWidth: 1.5, borderColor: theme.colors.accent },
        ]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {/* 服务器信息 */}
        <View style={styles.content}>
          <View style={styles.mainInfo}>
            <Text
              style={[styles.serverName, { color: theme.colors.textPrimary }]}
              numberOfLines={1}
            >
              {getServerDisplayName(config)}
            </Text>
            <View
              style={[
                styles.typeBadge,
                { backgroundColor: getTypeBadgeColors(config.type).backgroundColor },
              ]}
            >
              <Text style={[styles.typeText, { color: getTypeBadgeColors(config.type).color }]}>
                {getServerTypeLabel(config.type)}
              </Text>
            </View>
          </View>

          {config.type === 's3' && config.region ? (
            <Text
              style={[styles.serverUrl, { color: theme.colors.textSecondary }]}
              numberOfLines={1}
            >
              🌍 {config.region}
            </Text>
          ) : (
            <Text
              style={[styles.serverUrl, { color: theme.colors.textSecondary }]}
              numberOfLines={1}
            >
              {config.url}
            </Text>
          )}

          <View style={styles.details}>
            <Text style={[styles.detailText, { color: theme.colors.textSecondary }]}>
              {config.type === 's3'
                ? `🪣 ${config.bucketName || t('listItem.notSet')}`
                : `👤 ${config.username || t('listItem.notSet')}`}
            </Text>
          </View>
        </View>

        {/* 操作按钮 — M3 Filled Tonal */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.accentContainer }]}
            onPress={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            <Text style={[styles.actionButtonText, { color: theme.colors.onAccentContainer }]}>
              {t('action.edit', { ns: 'common' })}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: theme.colors.errorContainer }]}
            onPress={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
          >
            <Text style={[styles.actionButtonText, { color: theme.colors.onErrorContainer }]}>
              {t('action.delete', { ns: 'common' })}
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {showDeleteDialog && (
        <Host>
          <AlertDialog onDismissRequest={() => setShowDeleteDialog(false)}>
            <AlertDialog.Title>
              <ComposeText>{t('listItem.deleteConfirmTitle')}</ComposeText>
            </AlertDialog.Title>
            <AlertDialog.Text>
              <ComposeText>
                {t('listItem.deleteConfirmMessage', { name: getServerDisplayName(config) })}
              </ComposeText>
            </AlertDialog.Text>
            <AlertDialog.ConfirmButton>
              <TextButton
                onClick={() => {
                  setShowDeleteDialog(false);
                  onDelete();
                }}
              >
                <ComposeText>{t('action.delete', { ns: 'common' })}</ComposeText>
              </TextButton>
            </AlertDialog.ConfirmButton>
            <AlertDialog.DismissButton>
              <TextButton onClick={() => setShowDeleteDialog(false)}>
                <ComposeText>{t('action.cancel', { ns: 'common' })}</ComposeText>
              </TextButton>
            </AlertDialog.DismissButton>
          </AlertDialog>
        </Host>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    padding: spacing.base,
    marginHorizontal: spacing.base,
    marginBottom: spacing.md,
  },
  content: {
    marginBottom: spacing.md,
  },
  mainInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  serverName: {
    fontSize: typography.headline.fontSize,
    fontWeight: typography.headline.fontWeight,
    flex: 1,
    marginRight: spacing.sm,
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  typeText: {
    fontSize: typography.caption2.fontSize,
    fontWeight: '600',
  },
  serverUrl: {
    fontSize: typography.footnote.fontSize,
    marginBottom: spacing.sm,
  },
  details: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  detailText: {
    fontSize: typography.footnote.fontSize,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: typography.subhead.fontSize,
    fontWeight: '600',
  },
});
