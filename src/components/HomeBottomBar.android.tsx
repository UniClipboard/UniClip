import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { M3IconButton } from './android/M3IconButton';
import type { SelectModeBottomBarProps } from './HomeBottomBar.types';

/** 多选底栏:M3 bottom app bar 的图标按钮组(容器底色由宿主提供)。 */
export function SelectModeBottomBar({
  disabled,
  onCopy,
  onShare,
  onDelete,
  theme,
}: SelectModeBottomBarProps) {
  const { t } = useTranslation('common');
  const { colors } = theme;
  return (
    <View style={s.selectRow}>
      <M3IconButton
        testID="history-batch-copy"
        icon="copy-outline"
        accessibilityLabel={t('action.copy')}
        onPress={onCopy}
        disabled={disabled}
        colors={colors}
      />
      <M3IconButton
        testID="history-batch-share"
        icon="share-social-outline"
        accessibilityLabel={t('action.share')}
        onPress={onShare}
        disabled={disabled}
        colors={colors}
      />
      <M3IconButton
        testID="history-batch-delete"
        icon="trash-outline"
        accessibilityLabel={t('action.delete')}
        onPress={onDelete}
        disabled={disabled}
        iconColor={colors.error}
        colors={colors}
      />
    </View>
  );
}

const s = StyleSheet.create({
  selectRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
});
