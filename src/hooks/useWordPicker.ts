import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import * as Haptics from 'expo-haptics';
import { log } from '@/services/Logger';
import { useMessageStore } from '@/stores/messageStore';
import {
  buildCopyText,
  getSelectableIndices,
  remapSelection,
  tokenizeByChar,
  tokenizeWords,
  truncateForPicker,
  type SegToken,
} from '@/utils/wordSegmentation';

export type WordGranularity = 'word' | 'char';

export interface TokenFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 行索引：flex-wrap 的 tile 按行分桶，命中测试先找行带再在行内扫 x */
interface RowBucket {
  top: number;
  bottom: number;
  items: Array<{ index: number; left: number; right: number }>;
}

const HIT_SLOP = 3;
/** 涂选扫掠的路径采样步长：快速甩动时按段插值命中，不跳 tile */
const SWEEP_STEP = 12;

function buildRowIndex(frames: Map<number, TokenFrame>): RowBucket[] {
  const entries = [...frames.entries()].sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x);
  const rows: RowBucket[] = [];
  for (const [index, f] of entries) {
    const last = rows[rows.length - 1];
    const centerY = f.y + f.height / 2;
    if (last && centerY < last.bottom) {
      last.items.push({ index, left: f.x, right: f.x + f.width });
      last.top = Math.min(last.top, f.y);
      last.bottom = Math.max(last.bottom, f.y + f.height);
    } else {
      rows.push({
        top: f.y,
        bottom: f.y + f.height,
        items: [{ index, left: f.x, right: f.x + f.width }],
      });
    }
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.left - b.left);
  }
  return rows;
}

/**
 * 分词选择浮层的交互状态机，iOS/Android 两个渲染层共用：
 * token 化（延迟到入场动画后）、选区、粒度切换重映射、
 * 涂选手势（横扫立即涂、原地长按 250ms 涂、竖滑让给滚动）、复制/分享。
 *
 * 命中测试基于 tile 相对流式容器的 onLayout 坐标——GestureDetector 挂在
 * 滚动内容里的容器上，手势坐标天然是内容系，无需滚动偏移与 measureInWindow。
 */
export function useWordPicker(text: string, close: (after?: () => void) => void) {
  const { text: displayText, truncated } = useMemo(() => truncateForPicker(text), [text]);

  const [status, setStatus] = useState<'preparing' | 'ready'>('preparing');
  const [granularity, setGranularityState] = useState<WordGranularity>('word');
  const [tokens, setTokens] = useState<SegToken[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());

  // 涂选在手势回调里高频读写选区；ref 镜像避免闭包读到陈旧 state
  const selectedRef = useRef<ReadonlySet<number>>(selected);
  const tokenCacheRef = useRef<{ word?: SegToken[]; char?: SegToken[] }>({});
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
  }, []);

  /** 接入场动画完成回调；setTimeout(0) 让骨架屏先提交，再付词典加载的同步开销 */
  const beginTokenization = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setTimeout(() => {
      if (!mountedRef.current) return;
      const words = tokenizeWords(displayText);
      tokenCacheRef.current.word = words;
      setTokens(words);
      setStatus('ready');
    }, 0);
  }, [displayText]);

  const commitSelection = useCallback((next: ReadonlySet<number>) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  const setGranularity = useCallback(
    (g: WordGranularity) => {
      if (g === granularity || status !== 'ready') return;
      const cache = tokenCacheRef.current;
      const next =
        g === 'word'
          ? (cache.word ??= tokenizeWords(displayText))
          : (cache.char ??= tokenizeByChar(displayText));
      commitSelection(remapSelection(tokens, selectedRef.current, next));
      setTokens(next);
      setGranularityState(g);
    },
    [granularity, status, tokens, displayText, commitSelection]
  );

  // ── 布局注册与命中测试 ────────────────────────────────
  const framesRef = useRef(new Map<number, TokenFrame>());
  const rowIndexRef = useRef<RowBucket[] | null>(null);

  const registerTokenLayout = useCallback((index: number, frame: TokenFrame) => {
    framesRef.current.set(index, frame);
    rowIndexRef.current = null;
  }, []);

  // token 集变化时只清出界的旧条目：位置没变的 tile 不会重发 onLayout，
  // 整表清空会在这些 tile 上留下命中空洞
  useEffect(() => {
    const frames = framesRef.current;
    for (const index of frames.keys()) {
      if (index >= tokens.length || tokens[index].isWhitespace) frames.delete(index);
    }
    rowIndexRef.current = null;
  }, [tokens]);

  const hitTest = useCallback((x: number, y: number): number | null => {
    const rows = (rowIndexRef.current ??= buildRowIndex(framesRef.current));
    for (const row of rows) {
      if (y < row.top - HIT_SLOP || y > row.bottom + HIT_SLOP) continue;
      for (const item of row.items) {
        if (x >= item.left - HIT_SLOP && x <= item.right + HIT_SLOP) return item.index;
      }
      return null;
    }
    return null;
  }, []);

  // ── 涂选 ────────────────────────────────────────────
  const paintStateRef = useRef<{
    mode: 'select' | 'deselect';
    lastX: number;
    lastY: number;
  } | null>(null);

  const applyHits = useCallback(
    (hits: number[], mode: 'select' | 'deselect') => {
      if (hits.length === 0) return;
      let changed = false;
      const next = new Set(selectedRef.current);
      for (const idx of hits) {
        if (mode === 'select' ? !next.has(idx) : next.has(idx)) {
          if (mode === 'select') next.add(idx);
          else next.delete(idx);
          changed = true;
        }
      }
      if (!changed) return;
      commitSelection(next);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [commitSelection]
  );

  const beginPaint = useCallback(
    (x: number, y: number) => {
      const idx = hitTest(x, y);
      // 涂选方向 = 起点 token 状态取反；起点落空时默认涂选中
      const mode = idx !== null && selectedRef.current.has(idx) ? 'deselect' : 'select';
      paintStateRef.current = { mode, lastX: x, lastY: y };
      if (idx !== null) applyHits([idx], mode);
    },
    [hitTest, applyHits]
  );

  const paintTo = useCallback(
    (x: number, y: number) => {
      const st = paintStateRef.current;
      if (!st) return;
      const dx = x - st.lastX;
      const dy = y - st.lastY;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SWEEP_STEP));
      const hits: number[] = [];
      for (let s = 1; s <= steps; s++) {
        const idx = hitTest(st.lastX + (dx * s) / steps, st.lastY + (dy * s) / steps);
        if (idx !== null && !hits.includes(idx)) hits.push(idx);
      }
      st.lastX = x;
      st.lastY = y;
      applyHits(hits, st.mode);
    },
    [hitTest, applyHits]
  );

  const endPaint = useCallback(() => {
    paintStateRef.current = null;
  }, []);

  // 横向先动 → 立即涂选（此后二维自由跟踪）；纵向先动 → 交给滚动；
  // 原地按住 250ms → 涂选（RNGH：超时前位移过大则该手势失败，快速拖动仍是滚动）
  const paintGesture = useMemo(() => {
    const swipePan = Gesture.Pan()
      .activeOffsetX([-10, 10])
      .failOffsetY([-12, 12])
      .maxPointers(1)
      .runOnJS(true)
      .onStart((e) => beginPaint(e.x, e.y))
      .onUpdate((e) => paintTo(e.x, e.y))
      .onFinalize(endPaint);
    const holdPan = Gesture.Pan()
      .activateAfterLongPress(250)
      .maxPointers(1)
      .runOnJS(true)
      .onStart((e) => beginPaint(e.x, e.y))
      .onUpdate((e) => paintTo(e.x, e.y))
      .onFinalize(endPaint);
    return Gesture.Race(swipePan, holdPan);
  }, [beginPaint, paintTo, endPaint]);

  // ── 选区派生与动作 ──────────────────────────────────
  const selectableIndices = useMemo(() => getSelectableIndices(tokens), [tokens]);
  const hasSelectableTokens = selectableIndices.length > 0;
  const allSelected = selected.size > 0 && selected.size === selectableIndices.length;

  const previewText = useMemo(
    () => buildCopyText(displayText, tokens, selected),
    [displayText, tokens, selected]
  );

  const toggleToken = useCallback(
    (index: number) => {
      const next = new Set(selectedRef.current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      commitSelection(next);
    },
    [commitSelection]
  );

  const toggleSelectAll = useCallback(() => {
    commitSelection(allSelected ? new Set() : new Set(selectableIndices));
  }, [allSelected, selectableIndices, commitSelection]);

  const copySelected = useCallback(async () => {
    if (!previewText) return;
    try {
      // expo-clipboard 只有命名导出，不能解构 default
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(previewText);
    } catch (e) {
      log.error('[WordPicker] Copy to clipboard failed:', e);
      useMessageStore.getState().showMessage('复制失败', 'error');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // 退场动画结束后再冒泡 toast，让它显示在宿主屏幕里
    close(() => useMessageStore.getState().showMessage('已复制到剪贴板', 'success'));
  }, [previewText, close]);

  const shareSelected = useCallback(async () => {
    if (!previewText) return;
    try {
      await Share.share({ message: previewText });
    } catch {
      // 用户取消或系统分享不可用，静默即可
    }
  }, [previewText]);

  return {
    status,
    truncated,
    displayText,
    granularity,
    setGranularity,
    tokens,
    selected,
    selectedCount: selected.size,
    hasSelectableTokens,
    allSelected,
    previewText,
    beginTokenization,
    toggleToken,
    toggleSelectAll,
    copySelected,
    shareSelected,
    registerTokenLayout,
    paintGesture,
  };
}

/** 收起态预览条的最大高度：两行正文 + 上下内边距，超出部分被裁切 */
export const PREVIEW_COLLAPSED_MAX_HEIGHT = 64;

/**
 * 预览条的展开/收起动画，iOS/Android 两个皮肤共用。
 * 收起 = 两行截断；展开 = maxHeight 长到 expandedMaxHeight、内部滚动读全文。
 * 展开只改预览条自身高度，词条流宽度不变，命中测试注册表无需失效。
 * enabled 变 false（清空选区）时立即复位收起。
 */
export function usePreviewExpansion(expandedMaxHeight: number, enabled: boolean) {
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const progress = useSharedValue(0);
  const openRef = useRef(false);

  const hide = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (enabled) return;
    openRef.current = false;
    progress.value = 0;
    setExpanded(false);
  }, [enabled, progress]);

  const toggle = useCallback(() => {
    const duration = reducedMotion ? 0 : 220;
    const easing = Easing.bezier(0.2, 0, 0, 1);
    if (openRef.current) {
      openRef.current = false;
      // 收起动画放完再换回两行截断文本，避免中途文字重排跳变
      progress.value = withTiming(0, { duration, easing }, (finished) => {
        if (finished) scheduleOnRN(hide);
      });
    } else {
      openRef.current = true;
      setExpanded(true);
      progress.value = withTiming(1, { duration, easing });
    }
  }, [reducedMotion, progress, hide]);

  const barStyle = useAnimatedStyle(
    () => ({
      maxHeight: interpolate(
        progress.value,
        [0, 1],
        [PREVIEW_COLLAPSED_MAX_HEIGHT, expandedMaxHeight]
      ),
    }),
    [expandedMaxHeight]
  );
  const chevronStyle = useAnimatedStyle(
    () => ({ transform: [{ rotate: `${progress.value * 180}deg` }] }),
    []
  );

  return { expanded, toggle, barStyle, chevronStyle };
}
