import React, { useCallback, useEffect, useReducer, useRef } from 'react';
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

// 单张卡片的位置由 index 算出，定位采用「静态坐标 + 飞行增量」双层：静态 left/top
// 永远指向一个真实槽位，transform 只在下标变化引发的飞行期间承载增量，落地后把
// 静态坐标推进到新槽位并将增量归零（两者表示同一视觉位置，两次提交先后到达都不跳动）。
// 之所以不让 transform 独自承载位置：Reanimated 的样式桥接在快速挂载/卸载中偶发失效，
// 动画更新不再作用于视图，若位置只活在 transform 里，卡片会永久滞留在旧坐标，
// 它自己的槽位则显示为一个空洞；双层定位下最坏只是丢一次动画，静止位置始终正确。
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

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // 静态 left/top 当前指向的槽位；下标变化时保持旧槽位直到飞行落地
  const committedRef = useRef({ index, x: targetX, y: targetY });
  const latestTargetRef = useRef({ index, x: targetX, y: targetY });
  latestTargetRef.current = { index, x: targetX, y: targetY };
  const flyingRef = useRef(false);
  const [, bumpVersion] = useReducer((v: number) => v + 1, 0);

  const committed = committedRef.current;
  if (committed.index === index && (committed.x !== targetX || committed.y !== targetY)) {
    // 同下标但槽位坐标变化（屏幕旋转等引起 cardSize 变化）：直接跳到新坐标，不做动画。
    // 渲染期同步修正，保证本次提交里静态坐标与增量一致
    committed.x = targetX;
    committed.y = targetY;
    translateX.value = 0;
    translateY.value = 0;
  }

  const land = useCallback(() => {
    const latest = latestTargetRef.current;
    committedRef.current = { ...latest };
    flyingRef.current = false;
    translateX.value = 0;
    translateY.value = 0;
    bumpVersion();
    onAnimationEnd(itemHash);
  }, [itemHash, onAnimationEnd, translateX, translateY]);

  useEffect(() => {
    const c = committedRef.current;
    if (c.index === index && !flyingRef.current) return;
    flyingRef.current = true;
    onAnimationStart(itemHash);
    translateX.value = withSpring(targetX - c.x, GRID_CELL_SPRING_CONFIG);
    translateY.value = withSpring(targetY - c.y, GRID_CELL_SPRING_CONFIG, (finished) => {
      if (finished) scheduleOnRN(land);
    });
  }, [index, targetX, targetY, itemHash, onAnimationStart, land, translateX, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: committed.x,
          top: committed.y,
          width: cellSize,
          height: cellSize,
        },
        animatedStyle,
      ]}
    >
      {renderItem(item)}
    </Animated.View>
  );
}

export const GridCell = React.memo(GridCellInner) as typeof GridCellInner;
