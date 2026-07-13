import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const GRID_CELL_SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };

interface GridCellProps<T> {
  index: number;
  item: T;
  renderItem: (item: T) => React.ReactNode;
  numColumns: number;
  cardSize: number;
  renderCardSize?: number;
  spacing: number;
  paddingHorizontal: number;
  paddingTop: number;
}

// 静态 left/top 始终直接指向最终槽位；下标变化时，transform 先补偿回旧槽位，再归零。
// 因此动画结束无需把位置从 transform 交回 React，也不会触发整批卡片的落位刷新。
// 若 Reanimated 样式桥接失效，静态坐标仍是正确终点，最坏只会丢失移动动画而不会留空洞。
// 用 React.memo 包裹并把 renderItem(item) 挪到内部调用：快速滚动时虚拟化窗口频繁变化，
// 若父组件每次都重新生成子元素，已挂载、下标未变的卡片也会被迫整棵重渲染，
// 在 JS 线程本就紧张时进一步加重卡顿/错乱。
function GridCellInner<T>({
  index,
  item,
  renderItem,
  numColumns,
  cardSize,
  renderCardSize,
  spacing,
  paddingHorizontal,
  paddingTop,
}: GridCellProps<T>) {
  const cellSize = cardSize + spacing;
  const col = index % numColumns;
  const row = Math.floor(index / numColumns);
  const targetX = paddingHorizontal + col * cellSize;
  const targetY = paddingTop + row * cellSize;

  const positionX = useSharedValue(targetX);
  const positionY = useSharedValue(targetY);
  const previousIndexRef = useRef(index);

  useEffect(() => {
    const shouldAnimate = previousIndexRef.current !== index;
    previousIndexRef.current = index;
    positionX.set(shouldAnimate ? withSpring(targetX, GRID_CELL_SPRING_CONFIG) : targetX);
    positionY.set(shouldAnimate ? withSpring(targetY, GRID_CELL_SPRING_CONFIG) : targetY);
  }, [index, targetX, targetY, positionX, positionY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: positionX.get() - targetX },
      { translateY: positionY.get() - targetY },
    ],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: targetX,
          top: targetY,
          width: cellSize,
          height: cellSize,
        },
        animatedStyle,
      ]}
    >
      {renderCardSize ? (
        <View
          style={[
            styles.renderFrame,
            {
              left: spacing / 2,
              top: spacing / 2,
              width: renderCardSize,
              height: renderCardSize,
              transform: [{ scale: cardSize / renderCardSize }],
            },
          ]}
        >
          {renderItem(item)}
        </View>
      ) : (
        renderItem(item)
      )}
    </Animated.View>
  );
}

export const GridCell = React.memo(GridCellInner) as typeof GridCellInner;

const styles = StyleSheet.create({
  renderFrame: {
    position: 'absolute',
    transformOrigin: 'top left',
  },
});
