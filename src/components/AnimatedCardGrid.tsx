import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { LayoutChangeEvent, RefreshControlProps, ScrollView, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GridCell } from './GridCell';
import { buildOccurrenceKeys } from '@/utils/occurrenceKeys';

const OVERSCAN_MIN_PX = 400;

export interface AnimatedCardGridHandle {
  scrollToOffset: (options: { offset: number; animated?: boolean }) => void;
}

interface AnimatedCardGridProps<T> {
  items: T[];
  numColumns: number;
  cardSize: number;
  renderCardSize?: number;
  spacing: number;
  paddingHorizontal: number;
  paddingTop: number;
  paddingBottom: number;
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /**
   * iOS 专用:用 contentInset 在内容顶部预留空间(如筛选行 overlay)。
   * 与 paddingTop 的区别:UIRefreshControl 尊重 inset,下拉刷新的 spinner 不会被 overlay 遮挡。
   * scrollToOffset 的 offset 仍以内容坐标为准,组件内部会换算(offset 0 = 静止顶部)。
   */
  contentInsetTop?: number;
  /** UI 线程滚动回调(必须是 worklet),用于滚动联动 UI(如筛选行收展) */
  onScrollWorklet?: (y: number) => void;
  /** UI 线程滚动结束回调(必须是 worklet)。velocityY 非零表示拖拽松手后仍有惯性,终点以 momentumEnd(velocityY=0)为准 */
  onScrollEndWorklet?: (y: number, velocityY: number) => void;
}

// 自研虚拟化网格：每张卡片的位置纯粹由它在 items 里的下标算出（行/列 = index / numColumns），
// 不依赖 FlatList 的 numColumns 整行打包，也不依赖任何原生 measure。下标变化时卡片用弹簧动画
// 平滑过渡到新坐标；目的地滚出屏幕时会被 ScrollView 原生裁剪，而不是飞到"假坐标"。
function AnimatedCardGridInner<T>(
  {
    items,
    numColumns,
    cardSize,
    renderCardSize,
    spacing,
    paddingHorizontal,
    paddingTop,
    paddingBottom,
    keyExtractor,
    renderItem,
    refreshControl,
    contentInsetTop = 0,
    onScrollWorklet,
    onScrollEndWorklet,
  }: AnimatedCardGridProps<T>,
  ref: React.Ref<AnimatedCardGridHandle>
) {
  const scrollRef = useRef<ScrollView>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const cellSize = cardSize + spacing;
  const totalRows = Math.ceil(items.length / numColumns);
  const contentHeight = paddingTop + totalRows * cellSize + paddingBottom;

  // 渲染 key 经过出现序消歧:业务 key 出现重复(脏数据)时也保证 React key
  // 全局唯一,避免 key 冲突导致组件实例被过继给另一份副本(卡片乱飞/空洞)
  const cellKeys = useMemo(() => buildOccurrenceKeys(items, keyExtractor), [items, keyExtractor]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToOffset: ({ offset, animated }) => {
        // 有 inset 时静止顶部在 -inset,offset 以内容坐标为准换算
        scrollRef.current?.scrollTo({ y: offset - contentInsetTop, animated: animated ?? true });
      },
    }),
    [contentInsetTop]
  );

  // 滚动追踪放在 UI 线程（worklet）而不是 JS 线程的 onScroll：快速甩动时 JS 线程可能忙于
  // 渲染/状态更新而丢帧或延迟处理原生滚动事件，导致虚拟化窗口跟不上真实滚动位置，
  // 表现为卡片挂载/卸载错乱。UI 线程里做节流判断，只有跨过半行阈值才回传 JS 更新状态。
  const lastReportedScrollTop = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler(
    {
      onScroll: (event) => {
        const y = event.contentOffset.y;
        onScrollWorklet?.(y);
        if (Math.abs(lastReportedScrollTop.value - y) > cellSize / 2) {
          lastReportedScrollTop.value = y;
          scheduleOnRN(setScrollTop, y);
        }
      },
      onEndDrag: (event) => {
        onScrollEndWorklet?.(event.contentOffset.y, event.velocity?.y ?? 0);
      },
      onMomentumEnd: (event) => {
        onScrollEndWorklet?.(event.contentOffset.y, 0);
      },
    },
    [onScrollWorklet, onScrollEndWorklet, cellSize]
  );

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setViewportHeight(e.nativeEvent.layout.height);
  }, []);

  const overscan = Math.max(viewportHeight, OVERSCAN_MIN_PX);
  const windowStartRow = Math.max(0, Math.floor((scrollTop - paddingTop - overscan) / cellSize));
  const windowEndRow = Math.min(
    totalRows,
    Math.ceil((scrollTop - paddingTop + viewportHeight + overscan) / cellSize)
  );
  const windowStartIndex = windowStartRow * numColumns;
  const windowEndIndex = Math.min(items.length, windowEndRow * numColumns);

  // 只渲染可视窗口与缓冲区。GridCell 的静态坐标始终是最终槽位，移动动画只是
  // 从旧槽位到最终槽位的视觉补偿，因此无需在动画开始/结束时回写列表状态。
  const renderIndices = useMemo(() => {
    return Array.from(
      { length: Math.max(0, windowEndIndex - windowStartIndex) },
      (_, offset) => windowStartIndex + offset
    );
  }, [windowStartIndex, windowEndIndex]);

  return (
    <Animated.ScrollView
      ref={scrollRef}
      onScroll={scrollHandler}
      onLayout={handleLayout}
      scrollEventThrottle={1}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      contentInset={contentInsetTop > 0 ? { top: contentInsetTop } : undefined}
      contentOffset={contentInsetTop > 0 ? { x: 0, y: -contentInsetTop } : undefined}
      automaticallyAdjustContentInsets={false}
    >
      <View style={{ height: contentHeight }}>
        {renderIndices.map((i) => {
          const item = items[i];
          const cellKey = cellKeys[i];
          return (
            <GridCell
              key={cellKey}
              index={i}
              item={item}
              renderItem={renderItem}
              numColumns={numColumns}
              cardSize={cardSize}
              renderCardSize={renderCardSize}
              spacing={spacing}
              paddingHorizontal={paddingHorizontal}
              paddingTop={paddingTop}
            />
          );
        })}
      </View>
    </Animated.ScrollView>
  );
}

export const AnimatedCardGrid = forwardRef(AnimatedCardGridInner) as <T>(
  props: AnimatedCardGridProps<T> & { ref?: React.Ref<AnimatedCardGridHandle> }
) => React.ReactElement;
