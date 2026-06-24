/**
 * 设置页共享静态样式
 *
 * 拆分前这些样式集中在 SettingsScreen 内部的单个 StyleSheet。拆成多个 section
 * 子组件后，它们共用同一份静态样式（颜色等动态值仍由各组件用内联 + theme 注入）。
 * 父容器通过 `import { settingsStyles as styles }` 复用，避免改动既有引用。
 */
import { StyleSheet } from 'react-native';
import { spacing, radius, typography, elevation } from '@/theme';

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
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  collapseIcon: {
    marginTop: 1,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyCard: {
    marginHorizontal: spacing.base,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    padding: spacing.xxl,
    alignItems: 'center',
    ...elevation.sm,
  },
  emptyText: {
    fontSize: typography.callout.fontSize,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  emptyHint: {
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    marginHorizontal: spacing.base,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    ...elevation.sm,
  },
  settingRowNoBorder: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  settingInfo: {
    flex: 1,
    marginRight: spacing.base,
  },
  settingLabel: {
    fontSize: typography.callout.fontSize,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  settingDescription: {
    fontSize: typography.footnote.fontSize,
    lineHeight: typography.footnote.lineHeight,
  },
  appearanceBlock: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  swatchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  swatchWrap: {
    alignItems: 'center',
    flex: 1,
  },
  swatchRing: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 2,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: '100%',
    height: '100%',
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLabel: {
    fontSize: typography.caption1.fontSize,
    marginTop: spacing.xs,
  },
  segmentedTrack: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  segmentedItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
  },
  segmentedItemText: {
    fontSize: typography.subhead.fontSize,
    fontWeight: '500',
  },
  segmentedCheck: {
    marginRight: spacing.xs + 2,
  },
  bottomPadding: {
    height: 40,
  },
});
