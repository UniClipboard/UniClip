/**
 * 设置页共享静态样式
 *
 * 仅保留页面/分组容器与 RN 头部(PermissionsSection)所需的少量静态样式;
 * 颜色等动态值由各组件用内联 + theme 注入,或交给 @expo/ui 默认。
 */
import { StyleSheet } from 'react-native';
import { spacing, radius, typography } from '@/theme';

export const settingsStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  loadingPlaceholder: {
    paddingTop: spacing.xxl * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hostFill: {
    width: '100%',
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionHeaderBase: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: typography.sectionHeader.fontSize,
    fontWeight: typography.sectionHeader.fontWeight,
    textTransform: 'uppercase',
    letterSpacing: typography.sectionHeader.letterSpacing,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomPadding: {
    height: 40,
  },
});
