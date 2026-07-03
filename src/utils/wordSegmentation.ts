import { Segment, useDefault } from 'segmentit';

/**
 * 分词选择浮层的纯逻辑核心：切词、字符区间、选区映射、复制文本拼装。
 *
 * 关键不变式：任何切词函数返回的 tokens 连续覆盖 [0, text.length)，
 * 即 tokens.map(t => t.text).join('') === text。segmentit 的 doSegment
 * 会静默丢弃空白字符（空格 / 换行），直接累加 token 长度推算字符位置
 * 会在含空白的文本上整体漂移——所以这里把分词结果对齐回原文，
 * 丢掉的空隙物化成显式的 whitespace token。
 */

export interface SegToken {
  text: string;
  /** [start, end) 在（截断后）原文中的精确字符区间 */
  start: number;
  end: number;
  /** 纯空白 token：不可选中、不参与命中测试，仅用于还原原文与布局断行 */
  isWhitespace: boolean;
}

export const WORD_PICKER_MAX_CHARS = 5000;

const WHITESPACE_RE = /^\s+$/;

/** 超长文本截断（避免几万 token 的同步切词与渲染）；不劈开 surrogate pair */
export function truncateForPicker(text: string): { text: string; truncated: boolean } {
  if (text.length <= WORD_PICKER_MAX_CHARS) {
    return { text, truncated: false };
  }
  let end = WORD_PICKER_MAX_CHARS;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end -= 1;
  }
  return { text: text.slice(0, end), truncated: true };
}

// 模块级懒单例：useDefault 同步加载全量词典（Hermes 上百 ms 量级），
// 调用方负责把首次调用挪到入场动画之后
let segmentInstance: Segment | null = null;
function getSegment(): Segment {
  if (!segmentInstance) {
    segmentInstance = useDefault(new Segment());
  }
  return segmentInstance;
}

function makeToken(text: string, start: number): SegToken {
  return { text, start, end: start + text.length, isWhitespace: WHITESPACE_RE.test(text) };
}

/** 逐字模式：拉丁字母/数字连排与空白连排保持整体，其余（含 CJK）逐码点切分 */
export function tokenizeByChar(text: string): SegToken[] {
  const tokens: SegToken[] = [];
  // u flag 让 `.` 匹配完整码点，emoji 不会被劈成两个 surrogate 半块
  for (const m of text.matchAll(/[a-zA-Z0-9]+|\s+|./gu)) {
    tokens.push(makeToken(m[0], m.index ?? 0));
  }
  return tokens;
}

/** 词模式：segmentit 分词后对齐回原文，物化被丢弃的空隙 */
export function tokenizeWords(text: string): SegToken[] {
  if (!text) return [];
  let words: string[];
  try {
    words = getSegment()
      .doSegment(text)
      .map((t) => t.w);
  } catch {
    return tokenizeByChar(text);
  }

  const tokens: SegToken[] = [];
  const pushGap = (from: number, to: number) => {
    // 空隙通常是被丢掉的空白；防御性地走逐字切分，任何内容都能还原
    for (const t of tokenizeByChar(text.slice(from, to))) {
      tokens.push(makeToken(t.text, t.start + from));
    }
  };

  let cursor = 0;
  for (const w of words) {
    if (!w) continue;
    const idx = text.indexOf(w, cursor);
    if (idx === -1) {
      // 输出与原文对不上（不应发生）：余下整体退化为逐字，保住覆盖不变式
      pushGap(cursor, text.length);
      cursor = text.length;
      break;
    }
    if (idx > cursor) pushGap(cursor, idx);
    tokens.push(makeToken(w, idx));
    cursor = idx + w.length;
  }
  if (cursor < text.length) pushGap(cursor, text.length);
  return tokens;
}

export function getSelectableIndices(tokens: SegToken[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].isWhitespace) indices.push(i);
  }
  return indices;
}

/**
 * 分词↔逐字切换时按字符区间重叠把旧选区映射到新 token 集：
 * 旧选中 token 覆盖的任一字符落进新 token 区间即选中（空白 token 除外）。
 */
export function remapSelection(
  oldTokens: SegToken[],
  selected: ReadonlySet<number>,
  newTokens: SegToken[]
): Set<number> {
  const result = new Set<number>();
  if (selected.size === 0) return result;

  const ranges: Array<[number, number]> = [];
  for (const idx of selected) {
    const t = oldTokens[idx];
    if (t) ranges.push([t.start, t.end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);

  // 旧选区区间互不重叠且已排序，新 token 也按 start 递增：双指针一遍扫完
  let ri = 0;
  for (let i = 0; i < newTokens.length; i++) {
    const t = newTokens[i];
    if (t.isWhitespace) continue;
    while (ri < ranges.length && ranges[ri][1] <= t.start) ri++;
    if (ri < ranges.length && ranges[ri][0] < t.end) result.add(i);
  }
  return result;
}

/**
 * 选区 → 复制文本。选中 token 的最大连续段从原文逐字切片输出
 * （夹在两个选中 token 之间的空白随原文保留），段与段之间以换行连接。
 * 未选中的非空白 token 打断连续段。
 */
export function buildCopyText(
  text: string,
  tokens: SegToken[],
  selected: ReadonlySet<number>
): string {
  if (selected.size === 0) return '';

  const runs: Array<[number, number]> = [];
  let runStart = -1;
  let runEnd = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.isWhitespace) continue;
    if (selected.has(i)) {
      if (runStart === -1) runStart = t.start;
      runEnd = t.end;
    } else if (runStart !== -1) {
      runs.push([runStart, runEnd]);
      runStart = -1;
    }
  }
  if (runStart !== -1) runs.push([runStart, runEnd]);

  return runs.map(([s, e]) => text.slice(s, e)).join('\n');
}
