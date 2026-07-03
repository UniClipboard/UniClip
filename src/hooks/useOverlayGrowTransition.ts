import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { CardAnchorRect } from '@/components/CardContextOverlay.types';
import { overlayMotion } from '@/theme/motion';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 全屏浮层的锚定生长动画：内容以最终（全屏）尺寸渲染，从 anchor（卡片原位）
 * 位移/缩放弹入，退场反向收回。与 useCardContextTransition 是姊妹 hook——
 * 那边的浮层栈需要自测量与左右列定位，这边终态就是全屏，无需等布局；
 * 弹簧/时长参数经 overlayMotion 共享，保证两类浮层动效手感一致。
 *
 * anchor 为 null 时退化为居中淡入 + 轻微缩放（0.96 → 1）。
 * onEnterComplete 在入场动画完成后触发（reduced-motion 路径同样触发），
 * 供调用方把重活（如 segmentit 词典加载）挪出动画窗口。
 */
export function useOverlayGrowTransition(
  anchor: CardAnchorRect | null,
  onDismiss: () => void,
  onEnterComplete?: () => void
) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  const progress = useSharedValue(0);
  const closingRef = useRef(false);
  const enteredRef = useRef(false);
  const rootRef = useRef<View>(null);

  const onEnterCompleteRef = useRef(onEnterComplete);
  onEnterCompleteRef.current = onEnterComplete;

  // undefined = 归一化未完成；null = 无锚点（居中淡入）。
  // anchor 是卡片在主窗口里的坐标；浮层挂在 Modal（独立窗口）里，
  // 再测一次自身窗口原点做归一，抵消两个窗口原点可能的差异（Android 状态栏）
  const [resolvedAnchor, setResolvedAnchor] = useState<CardAnchorRect | null | undefined>(
    anchor ? undefined : null
  );
  useEffect(() => {
    if (!anchor) {
      setResolvedAnchor(null);
      return;
    }
    const node = rootRef.current;
    if (!node) {
      setResolvedAnchor(anchor);
      return;
    }
    node.measureInWindow((x, y) => {
      setResolvedAnchor({ ...anchor, x: anchor.x - (x || 0), y: anchor.y - (y || 0) });
    });
  }, [anchor]);

  const ready = resolvedAnchor !== undefined;

  useEffect(() => {
    if (!ready || enteredRef.current) return;
    enteredRef.current = true;
    const fireEnterComplete = () => {
      onEnterCompleteRef.current?.();
    };
    // close() 打断入场时 finished=false，不触发 onEnterComplete
    const onDone = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(fireEnterComplete);
    };
    progress.value = reducedMotion
      ? withTiming(1, { duration: overlayMotion.reducedMotionDuration }, onDone)
      : withSpring(1, overlayMotion.enterSpring, onDone);
  }, [ready, reducedMotion, progress]);

  const fromCenterX = resolvedAnchor ? resolvedAnchor.x + resolvedAnchor.width / 2 : screenW / 2;
  const fromCenterY = resolvedAnchor ? resolvedAnchor.y + resolvedAnchor.height / 2 : screenH / 2;
  const dx = fromCenterX - screenW / 2;
  const dy = fromCenterY - screenH / 2;
  const startScale = resolvedAnchor ? clamp(resolvedAnchor.width / screenW, 0.3, 0.92) : 0.96;

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }), []);
  const contentStyle = useAnimatedStyle(() => {
    if (!ready) return { opacity: 0 };
    const p = progress.value;
    if (reducedMotion) return { opacity: p };
    return {
      opacity: interpolate(p, [0, 0.35, 1], [0, 1, 1]),
      transform: [
        { translateX: dx * (1 - p) },
        { translateY: dy * (1 - p) },
        { scale: startScale + (1 - startScale) * p },
      ],
    };
  }, [ready, reducedMotion, dx, dy, startScale]);

  /** 播放退场动画，结束后触发 onDismiss；after 用于"动作完成后再执行"的时序 */
  const close = useCallback(
    (after?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      const finish = () => {
        onDismiss();
        after?.();
      };
      progress.value = withTiming(
        0,
        { duration: overlayMotion.exitDuration, easing: Easing.in(Easing.quad) },
        () => {
          scheduleOnRN(finish);
        }
      );
    },
    [onDismiss, progress]
  );

  return { rootRef, scrimStyle, contentStyle, close };
}
