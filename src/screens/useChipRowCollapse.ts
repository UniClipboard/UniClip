import { useCallback, useMemo, useState } from 'react';
import {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { FILTER_CHIP_ROW_HEIGHT } from '@/components/HomeFilterChipsRow.types';

const SNAP_DURATION_MS = 180;

/**
 * 筛选 chip 行的滚动联动收展:向下滚动时按 1:1 位移把行推出屏幕(跟手),向上滚动
 * 任意距离立即等量拉回;顶部(含下拉回弹,y<=0)强制全显。拖拽/惯性结束停在半途时,
 * 按过半原则 snap 到全显或全隐。位移逻辑全部跑在 UI 线程(worklet),行本身是
 * transform+opacity 的 overlay,收展不触发任何布局重排。
 *
 * @param topOffset 静止顶部的 contentOffset 修正:iOS 网格用 contentInset 预留筛选行
 *   空间时,静止位是 y = -inset,传 inset 把坐标归零;Android(paddingTop 方案)传 0。
 */
export function useChipRowCollapse(topOffset = 0) {
  // 0 = 全显 … FILTER_CHIP_ROW_HEIGHT = 全隐
  const hidden = useSharedValue(0);
  const prevY = useSharedValue(0);

  const onScrollWorklet = useCallback(
    (y: number) => {
      'worklet';
      const yc = y + topOffset;
      const delta = yc - prevY.value;
      prevY.value = yc;
      if (yc <= 0) {
        hidden.value = 0;
        return;
      }
      const next = hidden.value + delta;
      hidden.value = next < 0 ? 0 : next > FILTER_CHIP_ROW_HEIGHT ? FILTER_CHIP_ROW_HEIGHT : next;
    },
    [hidden, prevY, topOffset]
  );

  const onScrollEndWorklet = useCallback(
    (y: number, velocityY: number) => {
      'worklet';
      // 松手时还有惯性:先不 snap,让 onScroll 继续跟手,等 momentumEnd 收尾。
      // 已知边界:iOS 在 bounce 边缘偶发报非零 velocity 却不再发 momentum 事件,
      // 此时行停在半开,下一次滚动即自愈,不值得为此加超时兜底。
      if (velocityY !== 0) return;
      if (y + topOffset > 0 && hidden.value > 0 && hidden.value < FILTER_CHIP_ROW_HEIGHT) {
        hidden.value = withTiming(
          hidden.value > FILTER_CHIP_ROW_HEIGHT / 2 ? FILTER_CHIP_ROW_HEIGHT : 0,
          { duration: SNAP_DURATION_MS, easing: Easing.out(Easing.cubic) }
        );
      }
    },
    [hidden, topOffset]
  );

  /** JS 侧主动展开(如筛选后列表为空,必须让用户能撤掉筛选) */
  const reveal = useCallback(() => {
    hidden.value = withTiming(0, {
      duration: SNAP_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [hidden]);

  // 全隐时把行从无障碍树里摘掉:opacity 0 的 overlay 仍会被 VoiceOver/TalkBack 聚焦。
  // 只在「是否全隐」这个布尔值翻转时回传 JS,滚动过程中不产生跨线程流量。
  const [isFullyHidden, setIsFullyHidden] = useState(false);
  useAnimatedReaction(
    () => hidden.value >= FILTER_CHIP_ROW_HEIGHT,
    (current, previous) => {
      if (current !== previous) scheduleOnRN(setIsFullyHidden, current);
    }
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -hidden.value }],
    opacity: 1 - hidden.value / FILTER_CHIP_ROW_HEIGHT,
  }));

  return useMemo(
    () => ({ rowStyle, onScrollWorklet, onScrollEndWorklet, reveal, isFullyHidden }),
    [rowStyle, onScrollWorklet, onScrollEndWorklet, reveal, isFullyHidden]
  );
}
