/**
 * Android 分词选择页的皮肤行为：高亮带与首尾拖柄、标点不做成词块、托盘禁用态与统计、
 * 展开后的复制前编辑与拼接方式、返回键先收起预览再关页，以及复用既有 M3 组件。
 * useWordPicker 另有独立测试，这里用真实的选区工具函数拼出一个受控的 picker。
 */
import React from 'react';
import { Modal, StyleSheet, Text } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import {
  buildCopyText,
  getBandLayout,
  getSelectableIndices,
  getSelectionRuns,
  tokenizeByChar,
} from '@/utils/wordSegmentation';
import { lightColors } from '@/theme/colors';

jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('@/components/ConnectedMessageToast', () => ({ ConnectedMessageToast: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-gesture-handler', () => {
  const { View, ScrollView } = require('react-native');
  return {
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    GestureHandlerRootView: View,
    ScrollView,
  };
});
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const transition = { duration: () => transition };
  return {
    __esModule: true,
    default: { View },
    FadeIn: transition,
    FadeOut: transition,
    LinearTransition: transition,
  };
});
jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: { colors: require('@/theme/colors').lightColors } }),
}));
jest.mock('@/hooks/useWordPickerHint', () => ({ useWordPickerHint: () => false }));
const mockClose = jest.fn();
let mockSettled = true;
jest.mock('@/hooks/usePagePushTransition', () => ({
  usePagePushTransition: () => ({ pageStyle: {}, settled: mockSettled, close: mockClose }),
}));
let mockPicker: Record<string, unknown> = {};
jest.mock('@/hooks/useWordPicker', () => ({ useWordPicker: () => mockPicker }));

import { WordPickerOverlay } from '@/components/WordPickerOverlay.android';
import { M3IconButton } from '@/components/android/M3IconButton';
import { FilterChip } from '@/components/android/FilterChip';

const TEXT = '你好，世界 再见';
const tokens = tokenizeByChar(TEXT); // 你 好 ， 世 界 ␠ 再 见
const at = (ch: string) => tokens.findIndex((t) => t.text === ch);

function makePicker(selectedChars: string[], overrides: Record<string, unknown> = {}) {
  const selected = new Set(selectedChars.map(at));
  const runs = getSelectionRuns(tokens, selected);
  const previewText = buildCopyText(TEXT, tokens, selected, 'original');
  return {
    status: 'ready',
    truncated: false,
    granularity: 'word',
    setGranularity: jest.fn(),
    tokens,
    selected,
    selectedCount: selected.size,
    hasSelectableTokens: true,
    allSelected: selected.size === getSelectableIndices(tokens).length,
    previewText,
    charCount: [...previewText].filter((c) => !/\s/.test(c)).length,
    runs,
    band: getBandLayout(tokens, runs),
    handleRun: runs.length === 1 ? runs[0] : null,
    joinMode: 'original',
    setJoinMode: jest.fn(),
    outputText: previewText,
    setOutputText: jest.fn(),
    isEdited: false,
    beginTokenization: jest.fn(),
    toggleToken: jest.fn(),
    toggleSelectAll: jest.fn(),
    clearSelection: jest.fn(),
    copySelected: jest.fn(),
    shareSelected: jest.fn(),
    searchSelected: jest.fn(),
    registerTokenLayout: jest.fn(),
    paintGesture: {},
    ...overrides,
  };
}

function render(picker: Record<string, unknown>, onSendTo?: (text: string) => void) {
  mockPicker = picker;
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <WordPickerOverlay text={TEXT} onSendTo={onSendTo} onDismiss={jest.fn()} />
    );
  });
  return renderer.root;
}

const byTestID = (root: ReactTestInstance, id: string) =>
  root.findAll((n) => n.props.testID === id && typeof n.type !== 'string');

function textOf(root: ReactTestInstance, id: string): string {
  const [node] = byTestID(root, id);
  return node.findAllByType(Text).map((t) => [t.props.children].flat().join(''))[0];
}

beforeEach(() => {
  mockClose.mockClear();
  mockSettled = true;
});

describe('WordPickerOverlay (Android)', () => {
  it('renders punctuation as plain text and only words as tappable tiles', () => {
    const root = render(makePicker([]));
    // 同一 testID 会同时出现在 Pressable 与其宿主节点上，取最外层（带 onPress）的一个
    const tiles = root
      .findAll(
        (n) =>
          /^word-picker-token-/.test(n.props.testID ?? '') &&
          typeof n.props.onPress === 'function' &&
          typeof n.type !== 'string'
      )
      .filter((n, i, all) => all.findIndex((m) => m.props.testID === n.props.testID) === i);
    expect(tiles.map((t) => t.findByType(Text).props.children)).toEqual([
      '你',
      '好',
      '世',
      '界',
      '再',
      '见',
    ]);
    act(() => tiles[1].props.onPress());
    expect(mockPicker.toggleToken).toHaveBeenCalledWith(at('好'));
  });

  it('merges a run across punctuation into one band with handles at both ends', () => {
    const root = render(makePicker(['好', '世']));
    const comma = root.findAll((n) => n.type === Text && n.props.children === '，')[0];
    expect(comma.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: lightColors.onAccent })])
    );
    expect(byTestID(root, 'word-picker-handle-start')).toHaveLength(1);
    expect(byTestID(root, 'word-picker-handle-end')).toHaveLength(1);
  });

  it('hides handles for a selection split into several runs', () => {
    const root = render(makePicker(['你', '再']));
    expect(byTestID(root, 'word-picker-handle-start')).toHaveLength(0);
  });

  it('disables the whole tray while nothing is selected', () => {
    const root = render(makePicker([]));
    expect(textOf(root, 'word-picker-summary')).toBe('未选择');
    expect(byTestID(root, 'word-picker-clear')).toHaveLength(0);
    for (const id of ['word-picker-preview', 'word-picker-copy']) {
      expect(byTestID(root, id)[0].props.disabled).toBe(true);
    }
    for (const id of ['word-picker-search', 'word-picker-share']) {
      expect(byTestID(root, id)[0].props.disabled).toBe(true);
    }
  });

  it('summarises words and characters, and wires the tray actions', () => {
    const root = render(makePicker(['好', '世']));
    expect(textOf(root, 'word-picker-summary')).toBe('已选 2 个词 · 3 字');
    act(() => byTestID(root, 'word-picker-clear')[0].props.onPress());
    act(() => byTestID(root, 'word-picker-search')[0].props.onPress());
    act(() => byTestID(root, 'word-picker-copy')[0].props.onPress());
    expect(mockPicker.clearSelection).toHaveBeenCalled();
    expect(mockPicker.searchSelected).toHaveBeenCalled();
    expect(mockPicker.copySelected).toHaveBeenCalled();
  });

  it('counts characters only in char granularity', () => {
    const root = render(makePicker(['好', '世'], { granularity: 'char' }));
    expect(textOf(root, 'word-picker-summary')).toBe('已选 3 字');
  });

  it('expands into an editable preview; join modes appear only for separate runs', () => {
    let root = render(makePicker(['好', '世']));
    act(() => byTestID(root, 'word-picker-preview')[0].props.onPress());
    const [editor] = byTestID(root, 'word-picker-editor');
    expect(editor.props.value).toBe('好，世');
    act(() => editor.props.onChangeText('好的'));
    expect(mockPicker.setOutputText).toHaveBeenCalledWith('好的');
    expect(byTestID(root, 'word-picker-join-space')).toHaveLength(0);

    root = render(makePicker(['你', '再']));
    act(() => byTestID(root, 'word-picker-preview')[0].props.onPress());
    expect(root.findAllByType(FilterChip)).toHaveLength(3);
    act(() => byTestID(root, 'word-picker-join-space')[0].props.onPress());
    expect(mockPicker.setJoinMode).toHaveBeenCalledWith('space');
  });

  it('collapses the preview on back before closing the page', () => {
    const root = render(makePicker(['好']));
    act(() => byTestID(root, 'word-picker-preview')[0].props.onPress());
    act(() => root.findByType(Modal).props.onRequestClose());
    expect(byTestID(root, 'word-picker-editor')).toHaveLength(0);
    expect(mockClose).not.toHaveBeenCalled();
    act(() => root.findByType(Modal).props.onRequestClose());
    expect(mockClose).toHaveBeenCalled();
  });

  it('reuses the shared M3 icon button for back, search and share', () => {
    const root = render(makePicker(['好']));
    const ids = root.findAllByType(M3IconButton).map((b) => b.props.testID);
    expect(ids).toEqual(
      expect.arrayContaining(['word-picker-back', 'word-picker-search', 'word-picker-share'])
    );
  });

  it('shows the same search / share / send-to / copy row collapsed and expanded', () => {
    const onSendTo = jest.fn();
    const root = render(makePicker(['好'], { outputText: '好的' }), onSendTo);
    const actionIds = () =>
      root
        .findAll(
          (n) =>
            [M3IconButton].includes(n.type as never) ||
            (n.props.testID === 'word-picker-copy' && typeof n.type !== 'string')
        )
        .map((n) => n.props.testID)
        .filter((id, i, all) => id !== 'word-picker-back' && all.indexOf(id) === i);
    const expected = [
      'word-picker-search',
      'word-picker-share',
      'word-picker-send-to',
      'word-picker-copy',
    ];
    expect(actionIds()).toEqual(expected);

    act(() => byTestID(root, 'word-picker-preview')[0].props.onPress());
    expect(actionIds().filter((id) => id !== 'word-picker-collapse')).toEqual(expected);

    const [sendTo] = byTestID(root, 'word-picker-send-to');
    act(() => sendTo.props.onPress());
    expect(onSendTo).toHaveBeenCalledWith('好的');
  });

  it('sizes the tray icon buttons to match the 48dp copy button', () => {
    const root = render(makePicker(['好']), jest.fn());
    const tray = root
      .findAllByType(M3IconButton)
      .filter((b) =>
        ['word-picker-search', 'word-picker-share', 'word-picker-send-to'].includes(b.props.testID)
      );
    expect(tray).toHaveLength(3);
    expect(tray.every((b) => b.props.size === 'large' && b.props.variant === 'tonal')).toBe(true);
  });

  it('disables send-to with the rest of the tray while nothing is selected', () => {
    const root = render(makePicker([]), jest.fn());
    expect(byTestID(root, 'word-picker-send-to')[0].props.disabled).toBe(true);
  });

  it('hides send-to when the host does not provide it', () => {
    const root = render(makePicker(['好']));
    expect(byTestID(root, 'word-picker-send-to')).toHaveLength(0);
    act(() => byTestID(root, 'word-picker-preview')[0].props.onPress());
    expect(byTestID(root, 'word-picker-send-to')).toHaveLength(0);
  });
  it('keeps the tray flush with the bottom and animates its layout only after the page entered', () => {
    const { LinearTransition } = require('react-native-reanimated');
    const trayOf = (root: ReactTestInstance) =>
      root.find((n) => n.props.testID === 'word-picker-tray' && typeof n.type !== 'string');

    // 入场期间 Modal 根视图会从去掉系统栏的高度修正到整窗，托盘不能以过渡动画跟随这次修正
    mockSettled = false;
    const entering = trayOf(render(makePicker([])));
    expect(entering.props.layout).toBeUndefined();
    expect(StyleSheet.flatten(entering.props.style)).toMatchObject({ bottom: 0 });

    mockSettled = true;
    const settled = trayOf(render(makePicker([])));
    expect(settled.props.layout).toBe(LinearTransition);
  });
});
