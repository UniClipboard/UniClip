import {
  buildCopyText,
  getBandLayout,
  getSelectableIndices,
  getSelectionRuns,
  remapSelection,
  selectRange,
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

describe('punctuation tokens', () => {
  it('flags pure punctuation and keeps it out of the selectable set', () => {
    const tokens = tokenizeByChar('好，的。');
    expect(tokens.map((t) => t.isPunctuation)).toEqual([false, true, false, true]);
    expect(getSelectableIndices(tokens)).toEqual([0, 2]);
  });

  it('does not treat mixed tokens or symbols as punctuation', () => {
    const tokens = tokenizeByChar('v2 $ 1');
    expect(tokens.filter((t) => t.isPunctuation)).toEqual([]);
  });

  it('never remaps a selection onto non-selectable punctuation', () => {
    const text = '方案，带上';
    const words = tokenizeWords(text);
    const chars = tokenizeByChar(text);
    const all = new Set(getSelectableIndices(words));
    const remapped = remapSelection(words, all, chars);
    expect([...remapped].some((i) => chars[i].isPunctuation)).toBe(false);
  });

  it('carries punctuation inside a run into char mode where it is selectable', () => {
    const text = '方案，带上。下';
    const words = tokenizeWords(text);
    const chars = tokenizeByChar(text, { selectablePunctuation: true });
    const sel = new Set([
      words.findIndex((t) => t.text === '方案'),
      words.findIndex((t) => t.text === '带上'),
    ]);
    const remapped = remapSelection(words, sel, chars);
    expect([...remapped].map((i) => chars[i].text).join('')).toBe('方案，带上');
  });
});

describe('selectable punctuation (char mode)', () => {
  it('makes punctuation ordinary selectable tokens', () => {
    const tokens = tokenizeByChar('好，的', { selectablePunctuation: true });
    expect(tokens.map((t) => t.isPunctuation)).toEqual([false, false, false]);
    expect(getSelectableIndices(tokens)).toEqual([0, 1, 2]);
  });

  it('copies a lone selected punctuation mark', () => {
    const text = '好，的';
    const tokens = tokenizeByChar(text, { selectablePunctuation: true });
    expect(buildCopyText(text, tokens, new Set([1]))).toBe('，');
  });
});

describe('getSelectionRuns', () => {
  const text = '同步协议 v2 的迁移方案，带上压测数据。\n议程：保留';
  const tokens = tokenizeByChar(text);
  const at = (ch: string, from = 0) => tokens.findIndex((t, i) => i >= from && t.text === ch);

  it('spans whitespace and punctuation between selected tokens', () => {
    const sel = new Set([at('案'), at('带')]);
    const runs = getSelectionRuns(tokens, sel);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ firstSelected: at('案'), lastSelected: at('带') });
    expect(buildCopyText(text, tokens, sel)).toBe('案，带');
  });

  it('breaks a run at an unselected selectable token', () => {
    const runs = getSelectionRuns(tokens, new Set([at('同'), at('协')]));
    expect(runs.map((r) => [r.first, r.last])).toEqual([
      [at('同'), at('同')],
      [at('协'), at('协')],
    ]);
  });

  it('absorbs sentence-final punctuation before a line break', () => {
    const sel = new Set([at('数'), at('据')]);
    const [run] = getSelectionRuns(tokens, sel);
    expect(run.last).toBe(at('。'));
    expect(run.lastSelected).toBe(at('据'));
    expect(buildCopyText(text, tokens, sel)).toBe('数据。');
  });

  it('does not absorb a comma or colon followed by more text', () => {
    expect(buildCopyText(text, tokens, new Set([at('方'), at('案')]))).toBe('方案');
    expect(buildCopyText(text, tokens, new Set([at('程') - 1, at('程')]))).toBe('议程');
  });

  it('absorbs punctuation at the text edges when the run reaches them', () => {
    const quoted = '「你好」';
    const qTokens = tokenizeByChar(quoted);
    const sel = new Set(getSelectableIndices(qTokens));
    expect(buildCopyText(quoted, qTokens, sel)).toBe(quoted);
  });
});

describe('buildCopyText join modes', () => {
  const text = '明天下午 三点\n会议室';
  const tokens = tokenizeByChar(text);
  const at = (ch: string) => tokens.findIndex((t) => t.text === ch);

  it('original: no separator where the source had none', () => {
    const sel = new Set([at('明'), at('午')]);
    expect(buildCopyText(text, tokens, sel, 'original')).toBe('明午');
  });

  it('original: a space where the source gap had whitespace', () => {
    const sel = new Set([at('明'), at('点')]);
    expect(buildCopyText(text, tokens, sel, 'original')).toBe('明 点');
  });

  it('original: a line break where the source gap crossed lines', () => {
    const sel = new Set([at('明'), at('议')]);
    expect(buildCopyText(text, tokens, sel, 'original')).toBe('明\n议');
  });

  it('space and newline modes use a fixed separator', () => {
    const sel = new Set([at('明'), at('午'), at('议')]);
    expect(buildCopyText(text, tokens, sel, 'space')).toBe('明 午 议');
    expect(buildCopyText(text, tokens, sel, 'newline')).toBe('明\n午\n议');
  });
});

describe('selectRange', () => {
  it('selects every selectable token between two ends in either order', () => {
    const tokens = tokenizeByChar('你 好，世界');
    const expected = new Set([0, 2, 4]);
    expect(selectRange(tokens, 0, 4)).toEqual(expected);
    expect(selectRange(tokens, 4, 0)).toEqual(expected);
  });
});

describe('getBandLayout', () => {
  it('joins consecutive band items on the same line', () => {
    const text = '好的，走\n吧';
    const tokens = tokenizeByChar(text);
    const all = new Set(getSelectableIndices(tokens));
    const band = getBandLayout(tokens, getSelectionRuns(tokens, all));
    // 好 的 ， 走 \n 吧
    expect(band.map((b) => (b ? [b.joinPrev, b.joinNext] : null))).toEqual([
      [false, true],
      [true, true],
      [true, true],
      [true, false],
      null,
      [false, false],
    ]);
  });

  it('leaves unselected tokens out of the band', () => {
    const tokens = tokenizeByChar('好的');
    const band = getBandLayout(tokens, getSelectionRuns(tokens, new Set([1])));
    expect(band[0]).toBeNull();
    expect(band[1]).toEqual({ joinPrev: false, joinNext: false, runStart: true, runEnd: true });
  });
});
