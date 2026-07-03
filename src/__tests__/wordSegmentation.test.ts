import {
  buildCopyText,
  getSelectableIndices,
  remapSelection,
  tokenizeByChar,
  tokenizeWords,
  truncateForPicker,
  WORD_PICKER_MAX_CHARS,
  type SegToken,
} from '../utils/wordSegmentation';

const joinTokens = (tokens: SegToken[]) => tokens.map((t) => t.text).join('');

const expectExactPositions = (text: string, tokens: SegToken[]) => {
  for (const t of tokens) {
    expect(text.slice(t.start, t.end)).toBe(t.text);
  }
  // 连续覆盖：上一个 end 就是下一个 start
  let cursor = 0;
  for (const t of tokens) {
    expect(t.start).toBe(cursor);
    cursor = t.end;
  }
  expect(cursor).toBe(text.length);
};

describe('tokenizeWords', () => {
  it('round-trips text containing spaces and newlines (segmentit drops them)', () => {
    const text = '今天天气 really nice，明天\n继续 written in 中英混排\t结束';
    const tokens = tokenizeWords(text);
    expect(joinTokens(tokens)).toBe(text);
    expectExactPositions(text, tokens);
  });

  it('marks materialized gaps as whitespace tokens', () => {
    const text = '你好 世界';
    const tokens = tokenizeWords(text);
    const ws = tokens.filter((t) => t.isWhitespace);
    expect(ws).toHaveLength(1);
    expect(ws[0].text).toBe(' ');
    expect(ws[0].start).toBe(2);
  });

  it('returns [] for empty string', () => {
    expect(tokenizeWords('')).toEqual([]);
  });

  it('handles all-whitespace text', () => {
    const text = ' \n\t ';
    const tokens = tokenizeWords(text);
    expect(joinTokens(tokens)).toBe(text);
    expect(tokens.every((t) => t.isWhitespace)).toBe(true);
  });

  it('segments Chinese words with exact positions', () => {
    const text = '今天下午三点在会议室开产品评审会';
    const tokens = tokenizeWords(text);
    expectExactPositions(text, tokens);
    // 词典分词应产出多字词，而不是逐字
    expect(tokens.some((t) => t.text.length >= 2)).toBe(true);
  });
});

describe('tokenizeByChar', () => {
  it('splits CJK per character but keeps latin/digit runs whole', () => {
    const text = '你好abc123世界';
    const tokens = tokenizeByChar(text);
    expect(tokens.map((t) => t.text)).toEqual(['你', '好', 'abc123', '世', '界']);
    expectExactPositions(text, tokens);
  });

  it('keeps an emoji as a single token (no surrogate splitting)', () => {
    const text = 'a😀b';
    const tokens = tokenizeByChar(text);
    expect(tokens.map((t) => t.text)).toEqual(['a', '😀', 'b']);
  });

  it('keeps whitespace runs as single whitespace tokens', () => {
    const text = '你  \n好';
    const tokens = tokenizeByChar(text);
    expect(tokens.map((t) => t.text)).toEqual(['你', '  \n', '好']);
    expect(tokens[1].isWhitespace).toBe(true);
  });

  it('returns [] for empty string', () => {
    expect(tokenizeByChar('')).toEqual([]);
  });
});

describe('getSelectableIndices', () => {
  it('excludes whitespace tokens', () => {
    const tokens = tokenizeByChar('你 好');
    expect(getSelectableIndices(tokens)).toEqual([0, 2]);
  });
});

describe('remapSelection', () => {
  it('preserves selected characters across word→char→word on spaced text', () => {
    // 空白丢弃导致的位置漂移回归：含空格文本上往返切换选区不跑偏
    const text = '打开 settings 页面并保存';
    const wordTokens = tokenizeWords(text);
    const charTokens = tokenizeByChar(text);

    const settingsIdx = wordTokens.findIndex((t) => t.text === 'settings');
    expect(settingsIdx).toBeGreaterThanOrEqual(0);
    const selected = new Set([settingsIdx]);

    const inChars = remapSelection(wordTokens, selected, charTokens);
    const selectedCharText = charTokens
      .filter((_, i) => inChars.has(i))
      .map((t) => t.text)
      .join('');
    expect(selectedCharText).toBe('settings');

    const backToWords = remapSelection(charTokens, inChars, wordTokens);
    expect(backToWords).toEqual(selected);
  });

  it('expands a partial-word char selection to the whole word', () => {
    const text = '产品评审会';
    const wordTokens = tokenizeWords(text);
    const charTokens = tokenizeByChar(text);
    const multiCharIdx = wordTokens.findIndex((t) => t.text.length >= 2);
    expect(multiCharIdx).toBeGreaterThanOrEqual(0);

    // 只选词的第一个字符
    const firstCharPos = wordTokens[multiCharIdx].start;
    const charIdx = charTokens.findIndex((t) => t.start === firstCharPos);
    const remapped = remapSelection(charTokens, new Set([charIdx]), wordTokens);
    expect(remapped.has(multiCharIdx)).toBe(true);
  });

  it('returns empty set for empty selection', () => {
    const tokens = tokenizeByChar('你好');
    expect(remapSelection(tokens, new Set(), tokens).size).toBe(0);
  });

  it('never selects whitespace tokens', () => {
    const text = '你 好';
    const charTokens = tokenizeByChar(text);
    const all = new Set(charTokens.map((_, i) => i));
    const remapped = remapSelection(charTokens, all, charTokens);
    expect(remapped.has(1)).toBe(false);
  });
});

describe('buildCopyText', () => {
  const text = '今天 下午 三点 在 会议室';
  const tokens = tokenizeByChar(text); // ['今','天',' ','下','午',' ',…] CJK 逐字

  const indexOfChar = (ch: string, from = 0) =>
    tokens.findIndex((t, i) => i >= from && t.text === ch);

  it('returns empty string for empty selection', () => {
    expect(buildCopyText(text, tokens, new Set())).toBe('');
  });

  it('emits a contiguous run verbatim', () => {
    const sel = new Set([indexOfChar('今'), indexOfChar('天')]);
    expect(buildCopyText(text, tokens, sel)).toBe('今天');
  });

  it('keeps whitespace sandwiched between selected tokens', () => {
    // 选中「天」和「下」，中间的空格随原文保留
    const sel = new Set([indexOfChar('天'), indexOfChar('下')]);
    expect(buildCopyText(text, tokens, sel)).toBe('天 下');
  });

  it('joins disjoint runs with newline and drops unselected gaps', () => {
    const sel = new Set([indexOfChar('今'), indexOfChar('午')]);
    expect(buildCopyText(text, tokens, sel)).toBe('今\n午');
  });

  it('select-all reproduces the original text between first and last word', () => {
    const sel = new Set(getSelectableIndices(tokens));
    expect(buildCopyText(text, tokens, sel)).toBe(text);
  });

  it('trims outer pure-whitespace on select-all (deliberate)', () => {
    const padded = '  你好  ';
    const paddedTokens = tokenizeByChar(padded);
    const sel = new Set(getSelectableIndices(paddedTokens));
    expect(buildCopyText(padded, paddedTokens, sel)).toBe('你好');
  });
});

describe('truncateForPicker', () => {
  it('passes short text through', () => {
    expect(truncateForPicker('你好')).toEqual({ text: '你好', truncated: false });
  });

  it('truncates at the cap', () => {
    const long = 'a'.repeat(WORD_PICKER_MAX_CHARS + 100);
    const r = truncateForPicker(long);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(WORD_PICKER_MAX_CHARS);
  });

  it('does not split a surrogate pair at the boundary', () => {
    const long = 'a'.repeat(WORD_PICKER_MAX_CHARS - 1) + '😀' + 'b'.repeat(50);
    const r = truncateForPicker(long);
    expect(r.truncated).toBe(true);
    // 边界字符是 high surrogate → 回退一位，不产生残缺码点
    expect(r.text.length).toBe(WORD_PICKER_MAX_CHARS - 1);
    expect(r.text.endsWith('a')).toBe(true);
  });
});
