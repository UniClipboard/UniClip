import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { duration, overlayMotion } from '@/theme/motion';

/** 入场起点的水平偏移（占屏宽比例），近似 M3 shared axis X 的前进方向 */
const PUSH_OFFSET = 0.12;

/**
 * 全屏页面的推入 / 退出转场（M3 shared axis X）：从右侧少量位移并淡入，退出反向。
 * 与 useOverlayGrowTransition 的 close(after) / onEnterComplete 约定一致，
 * 调用方可以把重活挪到入场之后、把后续动作排在退场之后。
 */
export function usePagePushTransition(onDismiss: () => void, onEnterComplete?: () => void) {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const closingRef = useRef(false);
  const enteredRef = useRef(false);

  const onEnterCompleteRef = useRef(onEnterComplete);
  useLayoutEffect(() => {
    onEnterCompleteRef.current = onEnterComplete;
  }, [onEnterComplete]);

  useEffect(() => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    const fireEnterComplete = () => {
      onEnterCompleteRef.current?.();
    };
    progress.value = withTiming(
      1,
      {
        duration: reducedMotion ? overlayMotion.reducedMotionDuration : duration.slow,
        easing: Easing.bezier(0.05, 0.7, 0.1, 1),
      },
      (finished) => {
        if (finished) scheduleOnRN(fireEnterComplete);
      }
    );
  }, [reducedMotion, progress]);

  const pageStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (reducedMotion) return { opacity: p };
    return {
      opacity: interpolate(p, [0, 0.4, 1], [0, 1, 1]),
      transform: [{ translateX: width * PUSH_OFFSET * (1 - p) }],
    };
  }, [reducedMotion, width]);

  /** 播放退出动画，结束后触发 onDismiss；after 用于"动作完成后再执行"的时序 */
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
        { duration: duration.fast, easing: Easing.bezier(0.3, 0, 0.8, 0.15) },
        () => {
          scheduleOnRN(finish);
        }
      );
    },
    [onDismiss, progress]
  );

  return { pageStyle, close };
}
