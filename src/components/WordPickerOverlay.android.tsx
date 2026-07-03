import React, { useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectedMessageToast } from '@/components/ConnectedMessageToast';
import { useTheme } from '@/hooks/useTheme';
import { useOverlayGrowTransition } from '@/hooks/useOverlayGrowTransition';
import { usePreviewExpansion, useWordPicker, type TokenFrame } from '@/hooks/useWordPicker';
import type { ColorScheme } from '@/theme/colors';
import type { WordPickerOverlayProps } from './WordPickerOverlay.types';

/**
 * 分词选择浮层（Android / M3）：全屏不透明浮层从卡片原位生长，
 * 词条平铺成流，点按切换、横扫/长按涂选，底部为实时预览与操作条。
 * 交互全部在 useWordPicker，本文件只负责 M3 皮肤。
 */
export function WordPickerOverlay({ text, anchor = null, onDismiss }: WordPickerOverlayProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();

  // transition 需要 picker 的 beginTokenization，picker 需要 transition 的 close：
  // 用 ref 蹦床解开互相依赖
  const beginRef = useRef<() => void>(() => {});
  const t = useOverlayGrowTransition(anchor, onDismiss, () => beginRef.current());
  const picker = useWordPicker(text, t.close);
  beginRef.current = picker.beginTokenization;

  const hasSelection = picker.selectedCount > 0;
  const previewMaxHeight = Math.round(screenH * 0.4);
  const preview = usePreviewExpansion(previewMaxHeight, hasSelection);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => t.close()}
    >
      {/* RNGH 在 RN Modal 里需要自己的根，否则 Android 上手势静默失效 */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <View ref={t.rootRef} style={StyleSheet.absoluteFill} collapsable={false}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }, t.scrimStyle]}
            pointerEvents="none"
          />

          <Animated.View style={[StyleSheet.absoluteFill, t.contentStyle]}>
            <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
              <Pressable
                onPress={() => t.close()}
                style={[s.closeButton, { backgroundColor: colors.surfaceContainerHigh }]}
                accessibilityRole="button"
                accessibilityLabel="关闭"
              >
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
              <GranularityToggle
                value={picker.granularity}
                onChange={picker.setGranularity}
                colors={colors}
              />
            </View>

            {picker.truncated && (
              <Text style={[s.banner, { color: colors.onSurfaceVariant }]}>
                文本过长，仅显示前 5000 字
              </Text>
            )}

            {picker.status === 'preparing' ? (
              <SkeletonRows color={colors.surfaceContainerHigh} />
            ) : picker.hasSelectableTokens ? (
              <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
                <GestureDetector gesture={picker.paintGesture}>
                  <View style={s.flow} collapsable={false}>
                    {picker.tokens.map((token, index) => {
                      if (token.isWhitespace) {
                        return token.text.includes('\n') ? (
                          <View key={index} style={s.lineBreak} />
                        ) : (
                          <View key={index} style={s.spacer} />
                        );
                      }
                      return (
                        <TokenTile
                          key={index}
                          index={index}
                          text={token.text}
                          isSelected={picker.selected.has(index)}
                          onPress={picker.toggleToken}
                          onFrame={picker.registerTokenLayout}
                          colors={colors}
                        />
                      );
                    })}
                  </View>
                </GestureDetector>
              </ScrollView>
            ) : (
              <View style={s.emptyWrap}>
                <Text style={[s.emptyText, { color: colors.onSurfaceVariant }]}>
                  没有可选择的文本
                </Text>
              </View>
            )}

            <Pressable onPress={preview.toggle} disabled={!hasSelection}>
              <Animated.View
                style={[
                  s.previewBar,
                  { backgroundColor: colors.surfaceContainerHigh },
                  preview.barStyle,
                ]}
              >
                {hasSelection ? (
                  <View style={[s.previewRow, preview.expanded && s.previewRowExpanded]}>
                    <View style={[s.countBadge, { backgroundColor: colors.primary }]}>
                      <Text style={[s.countText, { color: colors.onPrimary }]}>
                        {picker.selectedCount}
                      </Text>
                    </View>
                    {preview.expanded ? (
                      <ScrollView
                        style={[s.previewScroll, { maxHeight: previewMaxHeight - 48 }]}
                        nestedScrollEnabled
                      >
                        <Text style={[s.previewText, { color: colors.onSurface }]}>
                          {picker.previewText}
                        </Text>
                      </ScrollView>
                    ) : (
                      <Text
                        style={[s.previewText, s.previewTextFill, { color: colors.onSurface }]}
                        numberOfLines={2}
                        ellipsizeMode="tail"
                      >
                        {picker.previewText}
                      </Text>
                    )}
                    <Animated.View style={preview.chevronStyle}>
                      <Ionicons name="chevron-up" size={16} color={colors.onSurfaceVariant} />
                    </Animated.View>
                  </View>
                ) : (
                  <View style={s.previewRow}>
                    <Text
                      style={[s.previewText, s.previewTextFill, { color: colors.onSurfaceVariant }]}
                    >
                      点按或滑动选择文字
                    </Text>
                  </View>
                )}
              </Animated.View>
            </Pressable>

            <View style={[s.actionBar, { paddingBottom: insets.bottom + 12 }]}>
              <Pressable
                onPress={picker.toggleSelectAll}
                disabled={!picker.hasSelectableTokens}
                style={[s.sideButton, { backgroundColor: colors.surfaceContainerHigh }]}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    s.sideButtonText,
                    { color: picker.hasSelectableTokens ? colors.onSurface : colors.outline },
                  ]}
                >
                  {picker.allSelected ? '取消全选' : '全选'}
                </Text>
              </Pressable>
              <Pressable
                onPress={picker.copySelected}
                disabled={!hasSelection}
                style={[
                  s.copyButton,
                  { backgroundColor: hasSelection ? colors.primary : colors.surfaceContainerHigh },
                ]}
                accessibilityRole="button"
              >
                <Ionicons
                  name="copy-outline"
                  size={18}
                  color={hasSelection ? colors.onPrimary : colors.outline}
                />
                <Text
                  style={[
                    s.copyButtonText,
                    { color: hasSelection ? colors.onPrimary : colors.outline },
                  ]}
                >
                  复制
                </Text>
              </Pressable>
              <Pressable
                onPress={picker.shareSelected}
                disabled={!hasSelection}
                style={[s.circleButton, { backgroundColor: colors.surfaceContainerHigh }]}
                accessibilityRole="button"
                accessibilityLabel="分享"
              >
                <Ionicons
                  name="share-outline"
                  size={20}
                  color={hasSelection ? colors.onSurface : colors.outline}
                />
              </Pressable>
            </View>
          </Animated.View>

          {/* 浮层开着时发出的 toast（如复制失败）要压在 Modal 内容之上才可见 */}
          <ConnectedMessageToast />
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function GranularityToggle({
  value,
  onChange,
  colors,
}: {
  value: 'word' | 'char';
  onChange: (g: 'word' | 'char') => void;
  colors: ColorScheme;
}) {
  return (
    <View style={[s.segTrack, { backgroundColor: colors.surfaceContainerHigh }]}>
      {(['word', 'char'] as const).map((g) => {
        const active = value === g;
        return (
          <Pressable
            key={g}
            onPress={() => onChange(g)}
            style={[s.segItem, active && { backgroundColor: colors.secondaryContainer }]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                s.segText,
                { color: active ? colors.onSecondaryContainer : colors.onSurfaceVariant },
              ]}
            >
              {g === 'word' ? '分词' : '逐字'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SkeletonRows({ color }: { color: string }) {
  return (
    <View style={s.skeletonWrap}>
      {(['92%', '78%', '86%', '60%'] as const).map((width, i) => (
        <View key={i} style={[s.skeletonBar, { width, backgroundColor: color }]} />
      ))}
    </View>
  );
}

interface TokenTileProps {
  index: number;
  text: string;
  isSelected: boolean;
  onPress: (index: number) => void;
  onFrame: (index: number, frame: TokenFrame) => void;
  colors: ColorScheme;
}

const TokenTile = React.memo(function TokenTile({
  index,
  text,
  isSelected,
  onPress,
  onFrame,
  colors,
}: TokenTileProps) {
  return (
    <Pressable
      onPress={() => onPress(index)}
      onLayout={(e) => onFrame(index, e.nativeEvent.layout)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      style={({ pressed }) => [
        s.tile,
        { backgroundColor: isSelected ? colors.primary : colors.surfaceContainerHigh },
        pressed && s.tilePressed,
      ]}
    >
      <Text
        style={[s.tileText, { color: isSelected ? colors.onPrimary : colors.onSurface }]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {text}
      </Text>
    </Pressable>
  );
});

const s = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segTrack: {
    flexDirection: 'row',
    borderRadius: 20,
    padding: 3,
  },
  segItem: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 17,
  },
  segText: {
    fontSize: 13,
    fontWeight: '500',
  },
  banner: {
    fontSize: 12,
    paddingHorizontal: 20,
    paddingBottom: 6,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  flow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  spacer: {
    width: 6,
  },
  lineBreak: {
    width: '100%',
    height: 2,
  },
  tile: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    maxWidth: '75%',
  },
  tilePressed: {
    opacity: 0.8,
  },
  tileText: {
    fontSize: 16,
    lineHeight: 21,
  },
  skeletonWrap: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  skeletonBar: {
    height: 38,
    borderRadius: 10,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
  },
  previewBar: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    minHeight: 48,
    overflow: 'hidden',
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  previewRowExpanded: {
    alignItems: 'flex-start',
  },
  previewScroll: {
    flex: 1,
  },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
  },
  previewText: {
    fontSize: 14,
    lineHeight: 19,
  },
  previewTextFill: {
    flex: 1,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 16,
  },
  sideButton: {
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  sideButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  copyButton: {
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  copyButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  circleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
});
