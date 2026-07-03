/**
 * ServerStatusDot — 首页左上角服务器状态指示点
 *
 * 纯展示组件（跨平台一致，只是一个带动画的圆点），颜色由调用方（各平台 TopBar）
 * 按 ConnectionStatus 决定并传入，因此两端可各自使用 Material / iOS 系统色而共享动画逻辑。
 *
 * 三种视觉：
 * - glow：在线时的静态柔光晕（呼吸感但不动，低开销）
 * - pulse：连接中 / 异常时向外扩散的雷达脉冲环
 * - 纯点：离线 / 未配置
 */

import React from 'react';
import { View, StyleSheet, type ColorValue } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';

interface ServerStatusDotProps {
  color: ColorValue;
  /** 向外扩散的脉冲环（连接中 / 异常） */
  pulse?: boolean;
  /** 静态柔光晕（在线） */
  glow?: boolean;
  /** 核心点直径，默认 8 */
  size?: number;
}

export function ServerStatusDot({
  color,
  pulse = false,
  glow = false,
  size = 8,
}: ServerStatusDotProps) {
  const p = useSharedValue(0);

  React.useEffect(() => {
    if (pulse) {
      p.value = withRepeat(
        withTiming(1, { duration: 1300, easing: Easing.out(Easing.ease) }),
        -1,
        false
      );
    } else {
      cancelAnimation(p);
      p.value = withTiming(0, { duration: 220 });
    }
    return () => cancelAnimation(p);
  }, [pulse, p]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: (1 - p.value) * 0.5,
    transform: [{ scale: 1 + p.value * 1.9 }],
  }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {pulse && (
        <Animated.View
          style={[
            styles.layer,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              backgroundColor: color,
            },
            ringStyle,
          ]}
        />
      )}
      {glow && (
        <View
          style={[
            styles.layer,
            styles.glow,
            {
              width: size * 2.4,
              height: size * 2.4,
              borderRadius: size * 1.2,
              marginLeft: -size * 1.2,
              marginTop: -size * 1.2,
              backgroundColor: color,
            },
          ]}
        />
      )}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  // 绝对定位 + 50% 定位 + 负 margin 半宽 → 相对核心点居中，脉冲/柔光从中心对称扩散
  layer: { position: 'absolute', left: '50%', top: '50%' },
  glow: { opacity: 0.18 },
});
