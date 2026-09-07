import React from 'react';
import { KeyboardAvoidingView, View, Keyboard, useWindowDimensions } from 'react-native';
import { Host, Menu, Button } from '@expo/ui/swift-ui';
import { Ellipsis, ListFilter } from 'lucide-react-native';
import { GlassContainer } from '@/components/ui';
import {
  getHistoryFilterDateOptions,
  HISTORY_FILTER_KIND_OPTIONS,
} from '@/utils/historyFilterOptions';
import { getDisplayKindLabel } from '@/utils/displayKind';
import { SelectModeTopBar } from '@/components/HomeTopBar';
import { HomeSearchDock } from './ios/HomeSearchDock';
import { iosColors } from '@/theme/iosDesignTokens';
import { useHomeController } from './useHomeController';
import { getLayoutMode } from '@/hooks/useLayoutMode';
import { HomeCompactView } from './HomeCompactView';
import { HomeExpandedView } from './HomeExpandedView';
import type { HomeViewProps } from './HomeView.types';

/**
 * iOS 首页。两级布局:
 * - compact  : iPhone(含横屏)/ iPad 分屏 —— 单栏(HomeCompactView)。
 * - expanded : iPad 全屏 / 大屏 —— 方案 B 三栏工作台 · inset(HomeExpandedView)。
 *
 * iOS 的 gutter/pane 底色走系统分组背景:gutter=systemGroupedBackground、
 * 浮起面板=secondarySystemGroupedBackground(网格区同为该面板色,中间区域是一个整体白面板)。
 * 双栏里的卡片取第三层的 tertiarySystemGroupedBackground(见 HomeMasterGrid),
 * 是系统为「嵌在 secondary 面板里的内容块」设计的层级色,明暗两主题都与面板有和谐对比。
 */
export function HomeView({ onOpenSettings }: HomeViewProps) {
  const c = useHomeController(onOpenSettings);
  const { width: screenWidth } = useWindowDimensions();
  const mode = getLayoutMode(screenWidth);

  if (mode === 'compact') {
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <HomeCompactView
          c={c}
          screenWidth={screenWidth}
          refreshTintColor={undefined}
          showFilterRow={false}
          overlayTopBarHeight={c.insets.top + 56}
          topBar={
            <View
              style={{
                paddingTop: c.insets.top + 4,
                paddingHorizontal: 16,
                minHeight: c.insets.top + 56,
              }}
            >
              {c.isSelectMode ? (
                <SelectModeTopBar
                  count={c.selectedIds.size}
                  allSelected={c.allSelected}
                  onSelectAll={c.handleSelectAll}
                  onDone={c.exitSelectMode}
                  theme={c.theme}
                />
              ) : (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 8,
                  }}
                >
                  <Host style={{ width: 44, height: 44 }}>
                    <Menu
                      label={
                        <GlassContainer
                          shape="circle"
                          interactive
                          style={{
                            width: 44,
                            height: 44,
                            justifyContent: 'center',
                            alignItems: 'center',
                          }}
                        >
                          <ListFilter size={22} color={c.theme.colors.textPrimary} />
                          {c.hasActiveFilters ? (
                            <View
                              style={{
                                position: 'absolute',
                                right: 6,
                                top: 6,
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                backgroundColor: c.theme.colors.accent,
                              }}
                            />
                          ) : null}
                        </GlassContainer>
                      }
                    >
                      <Menu label={c.t('filter.section.kind', { ns: 'history' })}>
                        <Button
                          label={c.t('search.allTypes')}
                          systemImage={c.selectedFilterKinds.length === 0 ? 'checkmark' : undefined}
                          onPress={c.handleClearFilterKinds}
                        />
                        {HISTORY_FILTER_KIND_OPTIONS.map((kind) => (
                          <Button
                            key={kind}
                            label={getDisplayKindLabel(kind)}
                            systemImage={
                              c.selectedFilterKinds.includes(kind) ? 'checkmark' : undefined
                            }
                            onPress={() => {
                              Keyboard.dismiss();
                              if (!c.selectedFilterKinds.includes(kind))
                                c.handleToggleFilterKind(kind);
                            }}
                          />
                        ))}
                      </Menu>
                      <Menu label={c.t('filter.section.date', { ns: 'history' })}>
                        {getHistoryFilterDateOptions().map((option) => (
                          <Button
                            key={option.value}
                            label={option.label}
                            systemImage={
                              c.selectedDateFilter === option.value ? 'checkmark' : undefined
                            }
                            onPress={() => {
                              Keyboard.dismiss();
                              c.setSelectedDateFilter(option.value);
                            }}
                          />
                        ))}
                      </Menu>
                      <Button
                        label={c.t('search.clearFilters')}
                        systemImage="arrow.counterclockwise"
                        onPress={c.handleClearFilters}
                      />
                    </Menu>
                  </Host>
                  <Host style={{ width: 44, height: 44, alignSelf: 'flex-end' }}>
                    <Menu
                      label={
                        <GlassContainer
                          shape="circle"
                          interactive
                          style={{
                            width: 44,
                            height: 44,
                            justifyContent: 'center',
                            alignItems: 'center',
                          }}
                        >
                          <Ellipsis size={22} color={c.theme.colors.textPrimary} />
                        </GlassContainer>
                      }
                    >
                      <Button
                        label={c.t('action.select', { ns: 'common' })}
                        systemImage="checkmark.circle"
                        onPress={() => {
                          c.setIsSelectMode(true);
                          c.clearSelection();
                        }}
                      />
                      <Button
                        label={c.t('action.settings', { ns: 'common' })}
                        systemImage="gearshape"
                        onPress={c.onOpenSettings}
                      />
                    </Menu>
                  </Host>
                </View>
              )}
            </View>
          }
          bottomSearch={<HomeSearchDock c={c} />}
        />
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <HomeExpandedView
        c={c}
        screenWidth={screenWidth}
        refreshTintColor={undefined}
        gutterColor={iosColors?.systemGroupedBackground ?? (c.theme.colors.background as string)}
        paneColor={iosColors?.secondarySystemGroupedBackground ?? c.theme.colors.surfaceLow}
      />
    </KeyboardAvoidingView>
  );
}
