import React, { useEffect, useRef } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

const GRID_CELL_SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };

interface GridCellProps<T> {
  index: number;
  itemHash: string;
  item: T;
  renderItem: (item: T) => React.ReactNode;
  numColumns: number;
  cardSize: number;
  spacing: number;
  paddingHorizontal: number;
  paddingTop: number;
  onAnimationStart: (hash: string) => void;
  onAnimationEnd: (hash: string) => void;
}

// 单张卡片的位置完全由 index 算出，下标不变时直接定位（含首次挂载、屏幕旋转引起的
// cardSize 变化），下标变化（排序重排）时才用弹簧动画平滑过渡——这样飞行终点永远是
// 卡片下标对应的真实坐标，不管当前是否在可视范围内，滚出屏幕由外层 ScrollView 原生裁剪。
// 用 React.memo 包裹并把 renderItem(item) 挪到内部调用：快速滚动时虚拟化窗口频繁变化，
// 若父组件每次都重新生成子元素，已挂载、下标未变的卡片也会被迫整棵重渲染，
// 在 JS 线程本就紧张时进一步加重卡顿/错乱。
function GridCellInner<T>({
  index,
  itemHash,
  item,
  renderItem,
  numColumns,
  cardSize,
  spacing,
  paddingHorizontal,
  paddingTop,
  onAnimationStart,
  onAnimationEnd,
}: GridCellProps<T>) {
  const cellSize = cardSize + spacing;
  const col = index % numColumns;
  const row = Math.floor(index / numColumns);
  const targetX = paddingHorizontal + col * cellSize;
  const targetY = paddingTop + row * cellSize;

  const translateX = useSharedValue(targetX);
  const translateY = useSharedValue(targetY);
  const prevIndexRef = useRef(index);

  useEffect(() => {
    const changed = prevIndexRef.current !== index;
    prevIndexRef.current = index;
    if (!changed) {
      translateX.value = targetX;
      translateY.value = targetY;
      return;
    }
    onAnimationStart(itemHash);
    translateX.value = withSpring(targetX, GRID_CELL_SPRING_CONFIG);
    translateY.value = withSpring(targetY, GRID_CELL_SPRING_CONFIG, (finished) => {
      if (finished) scheduleOnRN(onAnimationEnd, itemHash);
    });
  }, [index, targetX, targetY, translateX, translateY, itemHash, onAnimationStart, onAnimationEnd]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        { position: 'absolute', top: 0, left: 0, width: cellSize, height: cellSize },
        animatedStyle,
      ]}
    >
      {renderItem(item)}
    </Animated.View>
  );
}

export const GridCell = React.memo(GridCellInner) as typeof GridCellInner;
