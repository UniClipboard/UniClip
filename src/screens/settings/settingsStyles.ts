/**
 * 设置页共享静态样式
 *
 * 仅保留页面/分组容器所需的少量静态样式;颜色等动态值由各组件用内联 + theme 注入,
 * 或交给 @expo/ui 默认。
 */
import { StyleSheet } from 'react-native';
import { spacing } from '@/theme';

export const settingsStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingPlaceholder: {
    paddingTop: spacing.xxl * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
