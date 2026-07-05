import React, { useRef } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ColorValue,
} from 'react-native';
import Animated from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
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
  // 命名为 tr:本组件内的 t 是入场/退场过渡对象(useOverlayGrowTransition)
  const { t: tr } = useTranslation('history');
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
                style={[s.closeButton, { backgroundColor: colors.surfaceHigh }]}
                accessibilityRole="button"
                accessibilityLabel={tr('action.close', { ns: 'common' })}
              >
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
              <GranularityToggle
                value={picker.granularity}
                onChange={picker.setGranularity}
                colors={colors}
              />
            </View>

            {picker.truncated && (
              <Text style={[s.banner, { color: colors.textSecondary }]}>
                {tr('wordPicker.truncated', { count: 5000 })}
              </Text>
            )}

            {picker.status === 'preparing' ? (
              <SkeletonRows color={colors.surfaceHigh} />
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
                <Text style={[s.emptyText, { color: colors.textSecondary }]}>
                  {tr('wordPicker.empty')}
                </Text>
              </View>
            )}

            <Pressable onPress={preview.toggle} disabled={!hasSelection}>
              <Animated.View
                style={[s.previewBar, { backgroundColor: colors.surfaceHigh }, preview.barStyle]}
              >
                {hasSelection ? (
                  <View style={[s.previewRow, preview.expanded && s.previewRowExpanded]}>
                    <View style={[s.countBadge, { backgroundColor: colors.accent }]}>
                      <Text style={[s.countText, { color: colors.onAccent }]}>
                        {picker.selectedCount}
                      </Text>
                    </View>
                    {preview.expanded ? (
                      <ScrollView
                        style={[s.previewScroll, { maxHeight: previewMaxHeight - 48 }]}
                        nestedScrollEnabled
                      >
                        <Text style={[s.previewText, { color: colors.textPrimary }]}>
                          {picker.previewText}
                        </Text>
                      </ScrollView>
                    ) : (
                      <Text
                        style={[s.previewText, s.previewTextFill, { color: colors.textPrimary }]}
                        numberOfLines={2}
                        ellipsizeMode="tail"
                      >
                        {picker.previewText}
                      </Text>
                    )}
                    <Animated.View style={preview.chevronStyle}>
                      <Ionicons name="chevron-up" size={16} color={colors.textSecondary} />
                    </Animated.View>
                  </View>
                ) : (
                  <View style={s.previewRow}>
                    <Text
                      style={[s.previewText, s.previewTextFill, { color: colors.textSecondary }]}
                    >
                      {tr('wordPicker.placeholder')}
                    </Text>
                  </View>
                )}
              </Animated.View>
            </Pressable>

            <View style={[s.actionBar, { paddingBottom: insets.bottom + 12 }]}>
              <Pressable
                onPress={picker.toggleSelectAll}
                disabled={!picker.hasSelectableTokens}
                style={[s.sideButton, { backgroundColor: colors.surfaceHigh }]}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    s.sideButtonText,
                    { color: picker.hasSelectableTokens ? colors.textPrimary : colors.border },
                  ]}
                >
                  {picker.allSelected
                    ? tr('wordPicker.deselectAll')
                    : tr('action.selectAll', { ns: 'common' })}
                </Text>
              </Pressable>
              <Pressable
                onPress={picker.copySelected}
                disabled={!hasSelection}
                style={[
                  s.copyButton,
                  { backgroundColor: hasSelection ? colors.accent : colors.surfaceHigh },
                ]}
                accessibilityRole="button"
              >
                <Ionicons
                  name="copy-outline"
                  size={18}
                  color={hasSelection ? colors.onAccent : colors.border}
                />
                <Text
                  style={[
                    s.copyButtonText,
                    { color: hasSelection ? colors.onAccent : colors.border },
                  ]}
                >
                  {tr('action.copy', { ns: 'common' })}
                </Text>
              </Pressable>
              <Pressable
                onPress={picker.shareSelected}
                disabled={!hasSelection}
                style={[s.circleButton, { backgroundColor: colors.surfaceHigh }]}
                accessibilityRole="button"
                accessibilityLabel={tr('action.share', { ns: 'common' })}
              >
                <Ionicons
                  name="share-outline"
                  size={20}
                  color={hasSelection ? colors.textPrimary : colors.border}
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
  const { t } = useTranslation('history');
  return (
    <View style={[s.segTrack, { backgroundColor: colors.surfaceHigh }]}>
      {(['word', 'char'] as const).map((g) => {
        const active = value === g;
        return (
          <Pressable
            key={g}
            onPress={() => onChange(g)}
            style={[s.segItem, active && { backgroundColor: colors.accentContainer }]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                s.segText,
                { color: active ? colors.onAccentContainer : colors.textSecondary },
              ]}
            >
              {g === 'word' ? t('wordPicker.granularity.word') : t('wordPicker.granularity.char')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SkeletonRows({ color }: { color: ColorValue }) {
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
        { backgroundColor: isSelected ? colors.accent : colors.surfaceHigh },
        pressed && s.tilePressed,
      ]}
    >
      <Text
        style={[s.tileText, { color: isSelected ? colors.onAccent : colors.textPrimary }]}
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
