import { useCallback, useRef } from 'react';

/**
 * 把 OutlinedTextField 的 onFocusChanged 适配成「仅真正失焦时提交」。
 *
 * Jetpack Compose 的 onFocusChanged 在控件首次组合(进入设置页渲染)时,会立刻以
 * focused=false 回调一次。若直接把 !focused 当作失焦提交,会导致刚进页面就误触发一次
 * 保存。这里用 ref 记录是否曾真正聚焦过,只有「聚焦后再失焦」才执行 onBlur。
 */
export function useBlurCommit(onBlur: () => void) {
  const focusedRef = useRef(false);
  return useCallback(
    (focused: boolean) => {
      if (focused) {
        focusedRef.current = true;
      } else if (focusedRef.current) {
        focusedRef.current = false;
        onBlur();
      }
    },
    [onBlur]
  );
}
