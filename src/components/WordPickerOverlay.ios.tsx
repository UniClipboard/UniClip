import React, { useRef } from 'react';
import {
  DynamicColorIOS,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { ChevronUp, Copy, Share2, X } from 'lucide-react-native';
import { GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConnectedMessageToast } from '@/components/ConnectedMessageToast';
import { GlassContainer } from '@/components/ui';
import { useOverlayGrowTransition } from '@/hooks/useOverlayGrowTransition';
import { usePreviewExpansion, useWordPicker, type TokenFrame } from '@/hooks/useWordPicker';
import { iosAccent, iosAccentColor, iosColors, iosDimensions } from '@/theme/iosDesignTokens';
import type { WordPickerOverlayProps } from './WordPickerOverlay.types';

// 选中 tile / 主按钮上的前景色：accent 的明暗反相
const onAccentColor = DynamicColorIOS({ light: iosAccent.dark, dark: iosAccent.light });
const segmentActiveBg = DynamicColorIOS({ light: '#fff', dark: 'rgba(99,99,102,0.55)' });
const segmentActiveText = DynamicColorIOS({ light: '#000', dark: '#fff' });

const BTN = iosDimensions.floatingButtonSize;

/**
 * 分词选择浮层（iOS / Liquid Glass）：全屏玻璃浮层从卡片原位生长，
 * 词条平铺成流，点按切换、横扫/长按涂选，底部为实时预览与玻璃操作条。
 * 交互全部在 useWordPicker，本文件只负责皮肤。
 */
export function WordPickerOverlay({ text, anchor = null, onDismiss }: WordPickerOverlayProps) {
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
    <Modal visible transparent animationType="none" onRequestClose={() => t.close()}>
      {/* RNGH 在 RN Modal 里需要自己的根，否则手势可能静默失效 */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <View ref={t.rootRef} style={StyleSheet.absoluteFill} collapsable={false}>
          <Animated.View style={[StyleSheet.absoluteFill, t.scrimStyle]} pointerEvents="none">
            <BlurView intensity={90} tint="systemMaterial" style={StyleSheet.absoluteFill} />
            {/* 玻璃之上再压一层半透明底色，保证词条对比度、底屏几乎隐没 */}
            <View style={[StyleSheet.absoluteFill, s.wash]} />
          </Animated.View>

          <Animated.View style={[StyleSheet.absoluteFill, t.contentStyle]}>
            <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
              <Pressable
                onPress={() => t.close()}
                accessibilityRole="button"
                accessibilityLabel="关闭"
              >
                <GlassContainer shape="circle" interactive style={s.closeCircle}>
                  <X size={20} color={iosColors!.label} />
                </GlassContainer>
              </Pressable>

              <View style={s.segTrack}>
                {(['word', 'char'] as const).map((g) => {
                  const active = picker.granularity === g;
                  return (
                    <Pressable
                      key={g}
                      onPress={() => picker.setGranularity(g)}
                      style={[s.segItem, active && s.segItemActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[s.segText, active && s.segTextActive]}>
                        {g === 'word' ? '分词' : '逐字'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {picker.truncated && <Text style={s.banner}>文本过长，仅显示前 5000 字</Text>}

            {picker.status === 'preparing' ? (
              <View style={s.skeletonWrap}>
                {(['92%', '78%', '86%', '60%'] as const).map((width, i) => (
                  <View key={i} style={[s.skeletonBar, { width }]} />
                ))}
              </View>
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
                        />
                      );
                    })}
                  </View>
                </GestureDetector>
              </ScrollView>
            ) : (
              <View style={s.emptyWrap}>
                <Text style={s.emptyText}>没有可选择的文本</Text>
              </View>
            )}

            <Pressable onPress={preview.toggle} disabled={!hasSelection}>
              <Animated.View style={[s.previewClip, preview.barStyle]}>
                <GlassContainer shape="card" cornerRadius={16}>
                  {hasSelection ? (
                    <View style={[s.previewRow, preview.expanded && s.previewRowExpanded]}>
                      <View style={s.countBadge}>
                        <Text style={s.countText}>{picker.selectedCount}</Text>
                      </View>
                      {preview.expanded ? (
                        <ScrollView style={[s.previewScroll, { maxHeight: previewMaxHeight - 48 }]}>
                          <Text style={s.previewText}>{picker.previewText}</Text>
                        </ScrollView>
                      ) : (
                        <Text
                          style={[s.previewText, s.previewTextFill]}
                          numberOfLines={2}
                          ellipsizeMode="tail"
                        >
                          {picker.previewText}
                        </Text>
                      )}
                      <Animated.View style={preview.chevronStyle}>
                        <ChevronUp size={16} color={iosColors!.secondaryLabel} />
                      </Animated.View>
                    </View>
                  ) : (
                    <View style={s.previewRow}>
                      <Text style={s.previewPlaceholder}>点按或滑动选择文字</Text>
                    </View>
                  )}
                </GlassContainer>
              </Animated.View>
            </Pressable>

            <View style={[s.actionBar, { paddingBottom: insets.bottom + 12 }]}>
              <Pressable
                onPress={picker.toggleSelectAll}
                disabled={!picker.hasSelectableTokens}
                accessibilityRole="button"
              >
                <GlassContainer shape="capsule" interactive style={s.sideCapsule}>
                  <Text style={[s.sideText, !picker.hasSelectableTokens && s.disabledText]}>
                    {picker.allSelected ? '取消全选' : '全选'}
                  </Text>
                </GlassContainer>
              </Pressable>

              <Pressable
                onPress={picker.copySelected}
                disabled={!hasSelection}
                accessibilityRole="button"
                style={[s.copyCapsule, !hasSelection && s.copyCapsuleDisabled]}
              >
                <Copy size={18} color={onAccentColor} />
                <Text style={s.copyText}>复制</Text>
              </Pressable>

              <Pressable
                onPress={picker.shareSelected}
                disabled={!hasSelection}
                accessibilityRole="button"
                accessibilityLabel="分享"
              >
                <GlassContainer shape="circle" interactive style={s.circle}>
                  <Share2
                    size={22}
                    color={hasSelection ? iosColors!.label : iosColors!.tertiaryLabel}
                  />
                </GlassContainer>
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

interface TokenTileProps {
  index: number;
  text: string;
  isSelected: boolean;
  onPress: (index: number) => void;
  onFrame: (index: number, frame: TokenFrame) => void;
}

const TokenTile = React.memo(function TokenTile({
  index,
  text,
  isSelected,
  onPress,
  onFrame,
}: TokenTileProps) {
  return (
    <Pressable
      onPress={() => onPress(index)}
      onLayout={(e) => onFrame(index, e.nativeEvent.layout)}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      style={({ pressed }) => [
        s.tile,
        isSelected ? s.tileSelected : s.tileDefault,
        pressed && s.tilePressed,
      ]}
    >
      <Text
        style={[s.tileText, isSelected ? s.tileTextSelected : s.tileTextDefault]}
        numberOfLines={1}
        ellipsizeMode="middle"
      >
        {text}
      </Text>
    </Pressable>
  );
});

const s = StyleSheet.create({
  wash: {
    backgroundColor: iosColors?.systemBackground,
    opacity: 0.55,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  closeCircle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segTrack: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 2,
    backgroundColor: iosColors?.tertiarySystemFill,
  },
  segItem: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
  },
  segItemActive: {
    backgroundColor: segmentActiveBg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  segText: {
    fontSize: 13,
    fontWeight: '500',
    color: iosColors?.secondaryLabel,
  },
  segTextActive: {
    color: segmentActiveText,
  },
  banner: {
    fontSize: 12,
    paddingHorizontal: 20,
    paddingBottom: 6,
    color: iosColors?.secondaryLabel,
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
    borderRadius: 12,
    borderCurve: 'continuous',
    maxWidth: '75%',
  },
  tileDefault: {
    backgroundColor: iosColors?.tertiarySystemFill,
  },
  tileSelected: {
    backgroundColor: iosAccentColor,
  },
  tilePressed: {
    opacity: 0.75,
  },
  tileText: {
    fontSize: 16,
    lineHeight: 21,
  },
  tileTextDefault: {
    color: iosColors?.label,
  },
  tileTextSelected: {
    color: onAccentColor,
  },
  skeletonWrap: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  skeletonBar: {
    height: 38,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: iosColors?.tertiarySystemFill,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: iosColors?.secondaryLabel,
  },
  previewClip: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
    minHeight: 48,
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
    backgroundColor: iosAccentColor,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
    color: onAccentColor,
  },
  previewText: {
    fontSize: 14,
    lineHeight: 19,
    color: iosColors?.label,
  },
  previewTextFill: {
    flex: 1,
  },
  previewPlaceholder: {
    fontSize: 14,
    color: iosColors?.secondaryLabel,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 16,
  },
  sideCapsule: {
    height: BTN,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideText: {
    fontSize: 14,
    fontWeight: '500',
    color: iosColors?.label,
  },
  disabledText: {
    color: iosColors?.tertiaryLabel,
  },
  copyCapsule: {
    height: BTN,
    borderRadius: BTN / 2,
    borderCurve: 'continuous',
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: iosAccentColor,
  },
  copyCapsuleDisabled: {
    opacity: 0.35,
  },
  copyText: {
    fontSize: 15,
    fontWeight: '600',
    color: onAccentColor,
  },
  circle: {
    width: BTN,
    height: BTN,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
