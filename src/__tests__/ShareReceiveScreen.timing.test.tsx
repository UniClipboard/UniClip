/**
 * ShareReceiveScreen 分享落库时序回归测试
 *
 * 背景(回归防护):`useIncomingShare` 的 `isResolving` 初始为 `false`,真正的解析是在其
 * 内部 effect 里异步启动的(启动时才 `setIsResolving(true)`)。ShareReceiveScreen 的落库
 * effect 曾用 `if (isResolving) return` 作为「等解析完成」的门 —— 但首帧
 * (isResolving=false、resolvedSharedPayloads=[]) 会直接放行,拿空 payload 抛
 * 「没有可处理的分享内容」并被 `processedRef` 永久锁死;之后解析真正完成、payload 到位,
 * 却再也不会落库。表现:分享后一闪即返回来源 app,内容既不落库也不推送。
 *
 * 本测试用受控的 `useIncomingShare` mock 复现真实时序(false → true → false+payload),
 * 断言:
 *   1. 解析尚未产出结果时,绝不落库、不报错、不返回;
 *   2. 解析完成后恰好落库一次,用的是真实 payload,并入队后台推送。
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// React 19 的异步 act(async () => {...}) 需要此标志才能正确 drain,否则内部 await 永久挂起
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- 受控的 useIncomingShare 状态,供测试推进 ----
type ShareState = {
  sharedPayloads: unknown[];
  resolvedSharedPayloads: unknown[];
  isResolving: boolean;
  error: Error | null;
};
const mockShare: { state: ShareState; notify: () => void } = {
  state: { sharedPayloads: [], resolvedSharedPayloads: [], isResolving: false, error: null },
  notify: () => {},
};
const mockClearSharedPayloads = jest.fn();

jest.mock('expo-sharing', () => ({
  __esModule: true,
  useIncomingShare: () => {
    const react = require('react') as typeof import('react');
    const [, force] = react.useReducer((x: number) => x + 1, 0);
    react.useEffect(() => {
      mockShare.notify = force;
      return () => {
        mockShare.notify = () => {};
      };
    }, []);
    return {
      sharedPayloads: mockShare.state.sharedPayloads,
      resolvedSharedPayloads: mockShare.state.resolvedSharedPayloads,
      isResolving: mockShare.state.isResolving,
      error: mockShare.state.error,
      clearSharedPayloads: mockClearSharedPayloads,
      refreshSharePayloads: jest.fn(),
    };
  },
  getSharedPayloads: () => mockShare.state.sharedPayloads,
  clearSharedPayloads: (...args: unknown[]) => mockClearSharedPayloads(...args),
}));

const mockImportText = jest.fn(async () => ({ profileHash: 'hash-text' }));
const mockImportFile = jest.fn(async () => ({
  profileHash: 'hash-file',
  fileUri: 'file:///tmp/x',
  fileName: 'x',
  fileSize: 1,
  contentType: 'Image',
}));
jest.mock('@/utils/uploadFile', () => ({
  importTextToHistory: (...args: unknown[]) => mockImportText(...args),
  importFileToHistory: (...args: unknown[]) => mockImportFile(...args),
}));

const mockEnqueue = jest.fn();
jest.mock('@/services/BackgroundUploadManager', () => ({
  BackgroundUploadManager: { enqueue: (...args: unknown[]) => mockEnqueue(...args) },
}));

const mockShowMessage = jest.fn();
jest.mock('@/stores/messageStore', () => ({
  useMessageStore: (selector: (s: { showMessage: unknown }) => unknown) =>
    selector({ showMessage: mockShowMessage }),
}));

jest.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    theme: {
      colors: { surface: '#fff', textPrimary: '#000', accent: '#00aa00' },
      isDark: false,
    },
  }),
}));

jest.mock('@/services/Logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@expo/ui/jetpack-compose', () => {
  const react = require('react') as typeof import('react');
  return {
    Host: ({ children }: { children?: React.ReactNode }) =>
      react.createElement(react.Fragment, null, children),
    CircularProgressIndicator: () => null,
  };
});

import { ShareReceiveScreen } from '@/screens/ShareReceiveScreen';

// 纯 microtask flush(不依赖 setImmediate/定时器),用于结算落库 effect 内的 async IIFE
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

// 更新受控状态并通知订阅的 mock hook 重渲染。调用方负责包在 act(...) 中。
function advanceShare(next: Partial<ShareState>) {
  mockShare.state = { ...mockShare.state, ...next };
  mockShare.notify();
}

describe('ShareReceiveScreen 分享落库时序', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShare.state = {
      sharedPayloads: [],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
    };
  });

  it('文字分享:解析未完成前不落库,解析完成后恰好落库一次并入队推送', async () => {
    // 冷启动瞬间:原生已存有未解析 payload,但解析尚未开始(isResolving 仍为 false)
    mockShare.state = {
      sharedPayloads: [{ value: 'hi', shareType: 'text', mimeType: 'text/plain' }],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
    };
    const onComplete = jest.fn();

    act(() => {
      TestRenderer.create(<ShareReceiveScreen onComplete={onComplete} />);
    });
    await flush();

    // 首帧:解析尚未产出 → 旧 bug 会在此拿空 payload 报错并返回;修复后应静默等待
    expect(mockImportText).not.toHaveBeenCalled();
    expect(mockShowMessage).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    // 解析开始
    act(() => {
      advanceShare({ isResolving: true });
    });
    await flush();
    expect(mockImportText).not.toHaveBeenCalled();

    // 解析完成,产出真实 payload
    act(() => {
      advanceShare({
        isResolving: false,
        resolvedSharedPayloads: [
          { value: 'hi', shareType: 'text', mimeType: 'text/plain', contentUri: null },
        ],
      });
    });
    await flush();

    expect(mockImportText).toHaveBeenCalledTimes(1);
    expect(mockImportText).toHaveBeenCalledWith('hi');
    expect(mockImportFile).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith('hash-text');
    expect(mockShowMessage).not.toHaveBeenCalled();
  });

  it('文件分享:解析完成后用 contentUri 落库并入队推送', async () => {
    mockShare.state = {
      sharedPayloads: [{ value: 'content://x', shareType: 'image', mimeType: 'image/jpeg' }],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
    };
    const onComplete = jest.fn();

    act(() => {
      TestRenderer.create(<ShareReceiveScreen onComplete={onComplete} />);
    });
    await flush();
    expect(mockImportFile).not.toHaveBeenCalled();

    act(() => {
      advanceShare({ isResolving: true });
    });
    await flush();
    act(() => {
      advanceShare({
        isResolving: false,
        resolvedSharedPayloads: [
          {
            value: 'content://x',
            shareType: 'image',
            mimeType: 'image/jpeg',
            contentUri: 'file:///cache/pic.jpg',
            contentMimeType: 'image/jpeg',
            originalName: 'pic.jpg',
          },
        ],
      });
    });
    await flush();

    expect(mockImportFile).toHaveBeenCalledTimes(1);
    expect(mockImportFile).toHaveBeenCalledWith(
      'file:///cache/pic.jpg',
      'pic.jpg',
      'image/jpeg',
      undefined
    );
    expect(mockEnqueue).toHaveBeenCalledWith('hash-file');
    expect(mockShowMessage).not.toHaveBeenCalled();
  });
});
