import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { FAB_SIZE } from '@/components/AddActionsFab.types';
import type { MainTabParamList } from '@/navigation/AppNavigator.types';
import { m3Type } from '@/theme/m3Typography';
import { FLOATING_NAV_HEIGHT, FLOATING_NAV_MARGIN } from './mainNavigationMetrics';

/** 与 rail 的 Compose 矢量图标同一套 Material 字形。 */
const ICONS: Record<keyof MainTabParamList, keyof typeof MaterialIcons.glyphMap> = {
  Clipboard: 'content-paste',
  Devices: 'devices',
  Preferences: 'settings',
};

const PILL_PADDING = 8;
const ITEM_GAP = 4;
const ITEM_HEIGHT = FLOATING_NAV_HEIGHT - PILL_PADDING * 2;
const ICON_SIZE = 24;
/** 收起态:48dp 方形,图标居中。 */
const ITEM_MIN_WIDTH = ITEM_HEIGHT;
const COLLAPSED_PADDING = (ITEM_MIN_WIDTH - ICON_SIZE) / 2;
/** 展开态:左 16 + 图标 24 + 间距 8 + 标签 + 右 20。 */
const EXPANDED_PADDING_START = 16;
const EXPANDED_PADDING_END = 20;
const LABEL_GAP = 8;
/** 展开态相对收起态多出的固定宽度(不含标签)。 */
const EXPANDED_EXTRA =
  EXPANDED_PADDING_START + LABEL_GAP + EXPANDED_PADDING_END - COLLAPSED_PADDING;
/** 胶囊与右下 FAB 之间保留的最小间距(dp)。 */
const FAB_GAP = 12;
/** 手指横向移动超过该距离才进入拖拽切换,更短的触摸交给各目的地的点按。 */
const DRAG_ACTIVATION_DISTANCE = 8;
/** 选中位置、指示器、各项宽度共用一条弹簧,保证整体同步。 */
const SPRING = { damping: 26, stiffness: 300, mass: 0.9 };
/** 收起时下沉并略微缩小;出现用弹簧,收起用短促的加速曲线,先于菜单遮罩让开。 */
const HIDDEN_OFFSET_Y = 24;
const HIDDEN_SCALE = 0.9;
const SHOW_SPRING = { damping: 20, stiffness: 260, mass: 0.9 };
const HIDE_TIMING = { duration: 140, easing: Easing.in(Easing.quad) };
/** 拖拽中指示器略微放大,提示它已被「拿起」。 */
const DRAG_INDICATOR_SCALE = 0.06;

type Rect = { x: number; width: number };

export interface FloatingNavigationItem {
  key: string;
  name: keyof MainTabParamList;
  label: string;
  selected: boolean;
  onPress: () => void;
}

export interface FloatingNavigationColors {
  container: string;
  indicator: string;
  onIndicator: string;
  inactive: string;
}

interface FloatingNavigationBarProps {
  items: FloatingNavigationItem[];
  colors: FloatingNavigationColors;
  insets: EdgeInsets;
  /** 首页搜索 / 多选时收起。 */
  hidden: boolean;
  /** 首页添加菜单展开时收起(UI 线程驱动,不经 React 重渲)。 */
  hiddenByMenu: SharedValue<boolean>;
}

/**
 * 一次选中切换的过渡状态:从切换发起时各项的展开程度 / 指示器矩形,过渡到目标项
 * 独占展开。只有起点项收起、目标项展开,途经的项不受影响;中途再次切换从当下状态衔接。
 */
type Motion = { startExpansion: number[]; startRect: Rect; target: number };

/** 目的地 i 的展开程度(0 收起,1 完全展开)。 */
function expansion(i: number, motion: Motion, progress: number): number {
  'worklet';
  const start = motion.startExpansion[i] ?? 0;
  return start + ((i === motion.target ? 1 : 0) - start) * progress;
}

/** 目的地 i 在胶囊内的横向位置(相对胶囊左缘)。 */
function itemRect(i: number, motion: Motion, progress: number, extras: number[]): Rect {
  'worklet';
  let x = PILL_PADDING;
  let width = 0;
  for (let j = 0; j <= i; j++) {
    width = ITEM_MIN_WIDTH + expansion(j, motion, progress) * (extras[j] ?? 0);
    if (j < i) x += width + ITEM_GAP;
  }
  return { x, width };
}

/** 静止指示器:从切换起点的矩形滑向目标项(目标项此时也在展开)。 */
function restingIndicator(motion: Motion, progress: number, extras: number[]): Rect {
  'worklet';
  const to = itemRect(motion.target, motion, progress, extras);
  const from = motion.startRect;
  return {
    x: from.x + (to.x - from.x) * progress,
    width: from.width + (to.width - from.width) * progress,
  };
}

/** 手指所在(或最近)的目的地下标。 */
function hitTest(x: number, motion: Motion, progress: number, extras: number[]): number {
  'worklet';
  let nearest = 0;
  let nearestDistance = Infinity;
  for (let i = 0; i < extras.length; i++) {
    const rect = itemRect(i, motion, progress, extras);
    const distance = Math.abs(x - (rect.x + rect.width / 2));
    if (distance < nearestDistance) {
      nearest = i;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function settledMotion(index: number, count: number): Motion {
  return {
    startExpansion: Array.from({ length: count }, (_, i) => (i === index ? 1 : 0)),
    startRect: { x: 0, width: 0 },
    target: index,
  };
}

function tickHaptic() {
  Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick).catch(() => {});
}

/**
 * 手机顶级导航:M3 Expressive 悬浮胶囊。贴左下浮在内容之上,右侧让给首页 FAB,
 * 二者垂直居中对齐成一组。选中目的地展开为「图标 + 标签」,其余只显示图标。
 *
 * 动画只由一个过渡进度驱动:各项宽度、标签透明度、指示器位置与宽度都由它算出,
 * 因此始终同步;只有起点项收起、目标项展开,途经的项不动。点按 / 松手即刻起动画,
 * 不等导航完成。
 * 除点按外支持拖拽切换:按住胶囊横向滑动,指示器跟随手指并在经过的目的地上高亮
 * (刻度震动),松手后从手指处平滑落到目标上并切换。
 */
export function FloatingNavigationBar({
  items,
  colors,
  insets,
  hidden,
  hiddenByMenu,
}: FloatingNavigationBarProps) {
  const { width } = useWindowDimensions();
  const maxWidth =
    width - insets.left - insets.right - FLOATING_NAV_MARGIN * 2 - FAB_SIZE - FAB_GAP;
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.selected)
  );

  // 标签的自然宽度;长标签截到胶囊不压 FAB 为止
  const [labelWidths, setLabelWidths] = useState<(number | undefined)[]>([]);
  const maxLabelWidth = Math.max(
    0,
    maxWidth -
      PILL_PADDING * 2 -
      (items.length - 1) * (ITEM_MIN_WIDTH + ITEM_GAP) -
      ITEM_MIN_WIDTH -
      EXPANDED_EXTRA
  );
  const measured = items.every((_, i) => labelWidths[i] !== undefined);
  const clampedLabelWidths = useMemo(
    () => items.map((_, i) => Math.min(labelWidths[i] ?? 0, maxLabelWidth)),
    [items, labelWidths, maxLabelWidth]
  );

  const extras = useSharedValue<number[]>([]);
  useEffect(() => {
    extras.value = clampedLabelWidths.map((labelWidth) => EXPANDED_EXTRA + labelWidth);
  }, [extras, clampedLabelWidths]);

  const motion = useSharedValue<Motion>(settledMotion(selectedIndex, items.length));
  const progress = useSharedValue(1);
  // 拖拽:指示器在「静止位置」与「手指位置」之间按 drag 混合
  const drag = useSharedValue(0);
  const dragX = useSharedValue(0);
  const dragWidth = useSharedValue(0);
  const hovered = useSharedValue(-1);

  /** 从当前实际显示的状态起,过渡到 index 独占展开(UI 线程)。 */
  const retarget = useCallback(
    (index: number) => {
      'worklet';
      const list = extras.value;
      const current = motion.value;
      const p = progress.value;
      const rest = restingIndicator(current, p, list);
      const d = drag.value;
      motion.value = {
        startExpansion: list.map((_, i) => expansion(i, current, p)),
        startRect: {
          x: rest.x + (dragX.value - rest.x) * d,
          width: rest.width + (dragWidth.value - rest.width) * d,
        },
        target: index,
      };
      drag.value = 0;
      progress.value = 0;
      progress.value = withSpring(1, SPRING);
    },
    [drag, dragWidth, dragX, extras, motion, progress]
  );

  // 已发起动画的目标;导航完成后 selectedIndex 追上时不再重复起动画
  const targetRef = useRef(selectedIndex);
  const [highlightTarget, setHighlightTarget] = useState(selectedIndex);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const settle = useCallback((index: number) => {
    targetRef.current = index;
    setHighlightTarget(index);
  }, []);

  const moveTo = useCallback(
    (index: number) => {
      if (targetRef.current === index) return;
      settle(index);
      scheduleOnUI(retarget, index);
    },
    [retarget, settle]
  );

  // 外部导航(如通知跳转)改变选中项时同步
  useEffect(() => {
    moveTo(selectedIndex);
  }, [moveTo, selectedIndex]);

  const navigate = useCallback(
    (index: number) => {
      const item = items[index];
      if (item && !item.selected) item.onPress();
    },
    [items]
  );

  const activate = useCallback(
    (index: number) => {
      moveTo(index);
      navigate(index);
    },
    [moveTo, navigate]
  );

  const hover = useCallback((index: number) => {
    setHoveredIndex(index);
    tickHaptic();
  }, []);

  const endDrag = useCallback(
    (index: number) => {
      setHoveredIndex(null);
      if (index < 0) return;
      settle(index);
      navigate(index);
    },
    [navigate, settle]
  );

  const dragGesture = Gesture.Pan()
    .activeOffsetX([-DRAG_ACTIVATION_DISTANCE, DRAG_ACTIVATION_DISTANCE])
    .failOffsetY([-24, 24])
    .onStart((event) => {
      const list = extras.value;
      const rest = restingIndicator(motion.value, progress.value, list);
      dragX.value = rest.x;
      dragWidth.value = rest.width;
      drag.value = withSpring(1, SPRING);
      hovered.value = hitTest(event.x, motion.value, progress.value, list);
    })
    .onUpdate((event) => {
      const list = extras.value;
      const m = motion.value;
      const p = progress.value;
      const index = hitTest(event.x, m, p, list);
      const hoveredRect = itemRect(index, m, p, list);
      const first = itemRect(0, m, p, list);
      const last = itemRect(list.length - 1, m, p, list);
      // 指示器中心跟随手指,宽度过渡到所在目的地的宽度,不越出首尾两项
      dragWidth.value = withSpring(hoveredRect.width, SPRING);
      const w = dragWidth.value;
      dragX.value = Math.min(Math.max(event.x - w / 2, first.x), last.x + last.width - w);
      if (index !== hovered.value) {
        hovered.value = index;
        scheduleOnRN(hover, index);
      }
    })
    .onFinalize((_event, success) => {
      const index = success ? hovered.value : -1;
      hovered.value = -1;
      // 松手:从手指处的指示器直接过渡到目标;取消:指示器回到原位
      if (index >= 0) retarget(index);
      else drag.value = withSpring(0, SPRING);
      scheduleOnRN(endDrag, index);
    });

  const indicatorStyle = useAnimatedStyle(() => {
    const rest = restingIndicator(motion.value, progress.value, extras.value);
    const d = drag.value;
    return {
      width: rest.width + (dragWidth.value - rest.width) * d,
      transform: [
        { translateX: rest.x + (dragX.value - rest.x) * d },
        { scale: 1 + DRAG_INDICATOR_SCALE * d },
      ],
    };
  });

  const onLabelMeasured = useCallback((index: number, labelWidth: number) => {
    setLabelWidths((previous) => {
      if (previous[index] === labelWidth) return previous;
      const next = previous.slice();
      next[index] = labelWidth;
      return next;
    });
  }, []);

  const highlightedIndex = hoveredIndex ?? highlightTarget;

  // 收起 / 出现:始终挂载,只在 UI 线程上滑出 + 缩小 + 淡出,避免重挂载时状态重置闪一下
  const hiddenByProp = useSharedValue(hidden);
  useEffect(() => {
    hiddenByProp.value = hidden;
  }, [hidden, hiddenByProp]);
  const shown = useDerivedValue(() =>
    hiddenByProp.value || hiddenByMenu.value
      ? withTiming(0, HIDE_TIMING)
      : withSpring(1, SHOW_SPRING)
  );
  const layerStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, shown.value),
    transform: [
      { translateY: (1 - shown.value) * HIDDEN_OFFSET_Y },
      { scale: HIDDEN_SCALE + (1 - HIDDEN_SCALE) * shown.value },
    ],
  }));
  const layerProps = useAnimatedProps(() => ({
    pointerEvents: (hiddenByProp.value || hiddenByMenu.value ? 'none' : 'box-none') as
      | 'none'
      | 'box-none',
  }));

  return (
    <Animated.View
      animatedProps={layerProps}
      style={[
        styles.layer,
        {
          left: insets.left + FLOATING_NAV_MARGIN,
          bottom: insets.bottom + FLOATING_NAV_MARGIN,
        },
        layerStyle,
      ]}
    >
      {/* 离屏测量各标签的自然宽度 */}
      <View pointerEvents="none" style={styles.measure}>
        {items.map((item, index) => (
          <Text
            key={item.key}
            numberOfLines={1}
            style={styles.label}
            onLayout={(event: LayoutChangeEvent) =>
              onLabelMeasured(index, Math.ceil(event.nativeEvent.layout.width))
            }
          >
            {item.label}
          </Text>
        ))}
      </View>

      <GestureDetector gesture={dragGesture}>
        <View
          testID="main-tab-bar"
          accessibilityRole="tablist"
          style={[
            styles.pill,
            { backgroundColor: colors.container },
            !measured && styles.unmeasured,
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[styles.indicator, { backgroundColor: colors.indicator }, indicatorStyle]}
          />
          {items.map((item, index) => (
            <FloatingNavigationButton
              key={item.key}
              item={item}
              index={index}
              labelWidth={clampedLabelWidths[index]}
              motion={motion}
              progress={progress}
              extras={extras}
              tint={index === highlightedIndex ? colors.onIndicator : colors.inactive}
              onPress={activate}
            />
          ))}
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

function FloatingNavigationButton({
  item,
  index,
  labelWidth,
  motion,
  progress,
  extras,
  tint,
  onPress,
}: {
  item: FloatingNavigationItem;
  index: number;
  labelWidth: number;
  motion: SharedValue<Motion>;
  progress: SharedValue<number>;
  extras: SharedValue<number[]>;
  tint: string;
  onPress: (index: number) => void;
}) {
  const itemStyle = useAnimatedStyle(() => {
    const f = expansion(index, motion.value, progress.value);
    return {
      width: ITEM_MIN_WIDTH + f * (extras.value[index] ?? 0),
      paddingLeft: COLLAPSED_PADDING + (EXPANDED_PADDING_START - COLLAPSED_PADDING) * f,
    };
  });
  // 标签在腾出足够空间后才淡入,收起时先淡出,避免被裁切的半截文字
  const labelStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, (expansion(index, motion.value, progress.value) - 0.5) * 2),
  }));

  return (
    <Pressable
      testID={`main-tab-${item.name}`}
      onPress={() => onPress(index)}
      accessibilityRole="tab"
      accessibilityState={{ selected: item.selected }}
      accessibilityLabel={item.label}
    >
      <Animated.View style={[styles.item, itemStyle]}>
        <MaterialIcons name={ICONS[item.name]} size={ICON_SIZE} color={tint} />
        <Animated.Text
          numberOfLines={1}
          style={[styles.label, styles.itemLabel, { width: labelWidth, color: tint }, labelStyle]}
        >
          {item.label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
  },
  measure: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1000,
    alignItems: 'flex-start',
    opacity: 0,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ITEM_GAP,
    height: FLOATING_NAV_HEIGHT,
    padding: PILL_PADDING,
    borderRadius: FLOATING_NAV_HEIGHT / 2,
    elevation: 3,
  },
  unmeasured: {
    opacity: 0,
  },
  indicator: {
    position: 'absolute',
    left: 0,
    top: PILL_PADDING,
    height: ITEM_HEIGHT,
    borderRadius: ITEM_HEIGHT / 2,
  },
  item: {
    height: ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LABEL_GAP,
    overflow: 'hidden',
  },
  label: {
    ...m3Type.labelLarge,
  },
  itemLabel: {
    flexShrink: 0,
  },
});
