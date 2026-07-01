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
  spacing: number;
  paddingHorizontal: number;
  paddingTop: number;
  paddingBottom: number;
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}

// 自研虚拟化网格：每张卡片的位置纯粹由它在 items 里的下标算出（行/列 = index / numColumns），
// 不依赖 FlatList 的 numColumns 整行打包，也不依赖任何原生 measure。下标变化时卡片用弹簧动画
// 平滑过渡到新坐标；目的地滚出屏幕时会被 ScrollView 原生裁剪，而不是飞到"假坐标"。
function AnimatedCardGridInner<T>(
  {
    items,
    numColumns,
    cardSize,
    spacing,
    paddingHorizontal,
    paddingTop,
    paddingBottom,
    keyExtractor,
    renderItem,
    refreshControl,
  }: AnimatedCardGridProps<T>,
  ref: React.Ref<AnimatedCardGridHandle>
) {
  const scrollRef = useRef<ScrollView>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [animatingHashes, setAnimatingHashes] = useState<Set<string>>(new Set());

  const cellSize = cardSize + spacing;
  const totalRows = Math.ceil(items.length / numColumns);
  const contentHeight = paddingTop + totalRows * cellSize + paddingBottom;

  // 渲染 key 经过出现序消歧:业务 key 出现重复(脏数据)时也保证 React key
  // 全局唯一,避免 key 冲突导致组件实例被过继给另一份副本(卡片乱飞/空洞)
  const cellKeys = useMemo(() => buildOccurrenceKeys(items, keyExtractor), [items, keyExtractor]);

  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    cellKeys.forEach((key, i) => map.set(key, i));
    return map;
  }, [cellKeys]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToOffset: ({ offset, animated }) => {
        scrollRef.current?.scrollTo({ y: offset, animated: animated ?? true });
      },
    }),
    []
  );

  // 滚动追踪放在 UI 线程（worklet）而不是 JS 线程的 onScroll：快速甩动时 JS 线程可能忙于
  // 渲染/状态更新而丢帧或延迟处理原生滚动事件，导致虚拟化窗口跟不上真实滚动位置，
  // 表现为卡片挂载/卸载错乱。UI 线程里做节流判断，只有跨过半行阈值才回传 JS 更新状态。
  const lastReportedScrollTop = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    const y = event.contentOffset.y;
    if (Math.abs(lastReportedScrollTop.value - y) > cellSize / 2) {
      lastReportedScrollTop.value = y;
      scheduleOnRN(setScrollTop, y);
    }
  });

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setViewportHeight(e.nativeEvent.layout.height);
  }, []);

  const handleAnimationStart = useCallback((hash: string) => {
    setAnimatingHashes((prev) => {
      if (prev.has(hash)) return prev;
      const next = new Set(prev);
      next.add(hash);
      return next;
    });
  }, []);

  const handleAnimationEnd = useCallback((hash: string) => {
    setAnimatingHashes((prev) => {
      if (!prev.has(hash)) return prev;
      const next = new Set(prev);
      next.delete(hash);
      return next;
    });
  }, []);

  const overscan = Math.max(viewportHeight, OVERSCAN_MIN_PX);
  const windowStartRow = Math.max(0, Math.floor((scrollTop - paddingTop - overscan) / cellSize));
  const windowEndRow = Math.min(
    totalRows,
    Math.ceil((scrollTop - paddingTop + viewportHeight + overscan) / cellSize)
  );
  const windowStartIndex = windowStartRow * numColumns;
  const windowEndIndex = Math.min(items.length, windowEndRow * numColumns);

  // 渲染集合 = 可视窗口(含缓冲) ∪ 正在飞行中的卡片——后者哪怕已经飞出窗口范围
  // 也要保持挂载，直到动画播完，否则会在窗口边界被腰斩
  const renderIndices = useMemo(() => {
    const set = new Set<number>();
    for (let i = windowStartIndex; i < windowEndIndex; i++) set.add(i);
    animatingHashes.forEach((hash) => {
      const idx = indexMap.get(hash);
      if (idx !== undefined) set.add(idx);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [windowStartIndex, windowEndIndex, animatingHashes, indexMap]);

  return (
    <Animated.ScrollView
      ref={scrollRef}
      onScroll={scrollHandler}
      onLayout={handleLayout}
      scrollEventThrottle={1}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ height: contentHeight }}>
        {renderIndices.map((i) => {
          const item = items[i];
          const cellKey = cellKeys[i];
          return (
            <GridCell
              key={cellKey}
              index={i}
              itemHash={cellKey}
              item={item}
              renderItem={renderItem}
              numColumns={numColumns}
              cardSize={cardSize}
              spacing={spacing}
              paddingHorizontal={paddingHorizontal}
              paddingTop={paddingTop}
              onAnimationStart={handleAnimationStart}
              onAnimationEnd={handleAnimationEnd}
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
