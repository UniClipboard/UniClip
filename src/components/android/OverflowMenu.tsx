import React, { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import { m3Type } from '@/theme/m3Typography';
import type { ActionMenuItem } from '@/utils/actionMenuItems';
import { M3IconButton } from './M3IconButton';

interface OverflowMenuProps {
  items: ActionMenuItem[];
  testID?: string;
}

const MENU_MIN_WIDTH = 200;
const MENU_MAX_WIDTH = 280;

/**
 * M3 溢出菜单(⋮)。触发器为 48dp 图标按钮;菜单锚在按钮下方、右缘对齐,
 * 行高 48、前导图标 24、无行间分隔线、按压走 ripple,与 Compose DropdownMenu 一致。
 */
export function OverflowMenu({ items, testID }: OverflowMenuProps) {
  const { theme } = useTheme();
  const { colors } = theme;
  const { t } = useTranslation('common');
  const { width: windowWidth } = useWindowDimensions();
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  const open = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ top: y + h, right: Math.max(8, windowWidth - (x + w)) });
    });
  }, [windowWidth]);
  const close = useCallback(() => setAnchor(null), []);

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <M3IconButton
          testID={testID}
          icon="ellipsis-vertical"
          accessibilityLabel={t('action.more')}
          onPress={open}
          colors={colors}
        />
      </View>

      <Modal visible={anchor != null} transparent animationType="fade" onRequestClose={close}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityLabel={t('action.close')}
        />
        {anchor ? (
          <View
            accessibilityRole="menu"
            style={[
              styles.menu,
              { top: anchor.top, right: anchor.right, backgroundColor: colors.surfaceMid },
            ]}
          >
            {items.map((item) => {
              const color = item.destructive ? colors.error : colors.textPrimary;
              return (
                <Pressable
                  key={item.key}
                  testID={`overflow-action-${item.key}`}
                  accessibilityRole="menuitem"
                  onPress={() => {
                    close();
                    item.onPress();
                  }}
                  android_ripple={{ color: colors.fillSecondary as string }}
                  style={styles.item}
                >
                  <Ionicons
                    name={item.icon as keyof typeof Ionicons.glyphMap}
                    size={24}
                    color={item.destructive ? colors.error : colors.textSecondary}
                  />
                  <Text style={[styles.label, { color }]} numberOfLines={1}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    minWidth: MENU_MIN_WIDTH,
    maxWidth: MENU_MAX_WIDTH,
    paddingVertical: 8,
    borderRadius: 4,
    overflow: 'hidden',
    elevation: 3,
  },
  item: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  label: {
    ...m3Type.bodyLarge,
    flexShrink: 1,
  },
});
