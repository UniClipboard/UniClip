/**
 * ShareReceiveRedirector 转存时序回归测试
 *
 * 背景(继承自旧 ShareReceiveScreen 的回归防护):`useIncomingShare` 的
 * `isResolving` 初始为 `false`,真正的解析是在其内部 effect 里异步启动的
 * (启动时才 `setIsResolving(true)`)。转存 effect 若用 `if (isResolving) return`
 * 作为「等解析完成」的门,首帧(isResolving=false、resolvedSharedPayloads=[])
 * 会直接放行,拿空 payload 抛错并被 `processedRef` 永久锁死。
 *
 * 本测试用受控的 `useIncomingShare` mock 复现真实时序(false → true → false+payload),
 * 断言:
 *   1. 解析尚未产出结果时,绝不转存、不报错、不导航;
 *   2. 解析完成后恰好转存一次,文本/文件分流正确,然后清空 payload 并导航到分享页;
 *   3. 转存失败保留 toast 提示,仍导航到分享页;
 *   4. 重复 intent/重复渲染不重复入队(幂等)。
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

const mockStageText = jest.fn(async () => ({
  id: 'text-1',
  kind: 'text' as const,
  displayName: '分享的文本.txt',
  byteCount: 2,
  mimeType: 'text/plain',
  fileUri: 'file:///documents/pending-share/files/text-1.payload',
  createdAtMs: 1,
}));
const mockStageAsset = jest.fn(async () => ({
  id: 'asset-1',
  kind: 'image' as const,
  displayName: 'pic.jpg',
  byteCount: 0,
  mimeType: 'image/jpeg',
  fileUri: 'file:///documents/pending-share/files/asset-1.payload',
  createdAtMs: 1,
}));
jest.mock('@/features/transfer', () => ({
  createPendingShareStore: () => ({
    stageText: (...args: unknown[]) => mockStageText(...args),
    stageAsset: (...args: unknown[]) => mockStageAsset(...args),
    claimPending: jest.fn(async () => []),
    completeJob: jest.fn(async () => {}),
    releaseJob: jest.fn(async () => {}),
    cleanup: jest.fn(async () => {}),
  }),
}));

const mockOpenShareSheet = jest.fn();
jest.mock('@/stores/shareSheetStore', () => ({
  useShareSheetStore: {
    getState: () => ({ open: (...args: unknown[]) => mockOpenShareSheet(...args) }),
  },
}));

const mockShowMessage = jest.fn();
jest.mock('@/stores/messageStore', () => ({
  useMessageStore: (selector: (s: { showMessage: unknown }) => unknown) =>
    selector({ showMessage: mockShowMessage }),
}));

jest.mock('@/support/observability', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { ShareReceiveRedirector } from '@/screens/ShareReceiveRedirector';

// 纯 microtask flush(不依赖 setImmediate/定时器),用于结算转存 effect 内的 async IIFE
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

// 更新受控状态并通知订阅的 mock hook 重渲染。调用方负责包在 act(...) 中。
function advanceShare(next: Partial<ShareState>) {
  mockShare.state = { ...mockShare.state, ...next };
  mockShare.notify();
}

describe('ShareReceiveRedirector 转存时序', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShare.state = {
      sharedPayloads: [],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
    };
  });

  it('文字分享:解析未完成前不转存,完成后恰好转存一次并打开分享弹层', async () => {
    mockShare.state = {
      sharedPayloads: [{ value: 'hi', shareType: 'text', mimeType: 'text/plain' }],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
    };
    const onComplete = jest.fn();

    act(() => {
      TestRenderer.create(<ShareReceiveRedirector onComplete={onComplete} />);
    });
    await flush();

    // 首帧:解析尚未产出 → 旧 bug 会在此拿空 payload 报错并返回;修复后应静默等待
    expect(mockStageText).not.toHaveBeenCalled();
    expect(mockShowMessage).not.toHaveBeenCalled();
    expect(mockOpenShareSheet).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    // 解析开始
    act(() => {
      advanceShare({ isResolving: true });
    });
    await flush();
    expect(mockStageText).not.toHaveBeenCalled();

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

    expect(mockStageText).toHaveBeenCalledTimes(1);
    expect(mockStageText).toHaveBeenCalledWith('hi');
    expect(mockStageAsset).not.toHaveBeenCalled();
    expect(mockClearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(mockOpenShareSheet).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(mockShowMessage).not.toHaveBeenCalled();
  });

  it('文件分享:解析完成后用 contentUri 转存图片/文件 payload', async () => {
    mockShare.state = {
      sharedPayloads: [{ value: 'content://x', shareType: 'image', mimeType: 'image/jpeg' }],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
    };
    const onComplete = jest.fn();

    act(() => {
      TestRenderer.create(<ShareReceiveRedirector onComplete={onComplete} />);
    });
    await flush();
    expect(mockStageAsset).not.toHaveBeenCalled();

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
            contentUri: 'content://media/pic.jpg',
            contentMimeType: 'image/jpeg',
            originalName: 'pic.jpg',
          },
        ],
      });
    });
    await flush();

    expect(mockStageAsset).toHaveBeenCalledTimes(1);
    expect(mockStageAsset).toHaveBeenCalledWith('content://media/pic.jpg', 'pic.jpg', 'image/jpeg');
    expect(mockStageText).not.toHaveBeenCalled();
    expect(mockOpenShareSheet).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('URL 分享按文本转存(浏览器分享链接时 contentUri 是 https://)', async () => {
    mockShare.state = {
      sharedPayloads: [{ value: 'https://example.com', shareType: 'url', mimeType: 'text/plain' }],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
    };
    act(() => {
      TestRenderer.create(<ShareReceiveRedirector onComplete={jest.fn()} />);
    });
    await flush();
    act(() => {
      advanceShare({ isResolving: true });
    });
    await flush();
    act(() => {
      advanceShare({
        isResolving: false,
        resolvedSharedPayloads: [
          {
            value: 'https://example.com',
            shareType: 'url',
            mimeType: 'text/plain',
            contentUri: 'https://example.com',
          },
        ],
      });
    });
    await flush();

    expect(mockStageText).toHaveBeenCalledWith('https://example.com');
    expect(mockStageAsset).not.toHaveBeenCalled();
  });

  it('转存失败保留 toast 提示,仍清空 payload 并导航到分享页', async () => {
    mockShare.state = {
      sharedPayloads: [{ value: '', shareType: 'text', mimeType: 'text/plain' }],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
    };
    const onComplete = jest.fn();

    act(() => {
      TestRenderer.create(<ShareReceiveRedirector onComplete={onComplete} />);
    });
    await flush();
    act(() => {
      advanceShare({ isResolving: true });
    });
    await flush();
    act(() => {
      advanceShare({
        isResolving: false,
        resolvedSharedPayloads: [
          { value: '', shareType: 'text', mimeType: 'text/plain', contentUri: null },
        ],
      });
    });
    await flush();

    expect(mockStageText).not.toHaveBeenCalled();
    expect(mockShowMessage).toHaveBeenCalledTimes(1);
    expect(mockClearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(mockOpenShareSheet).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('重复渲染(重复 intent)不重复入队', async () => {
    mockShare.state = {
      sharedPayloads: [{ value: 'hi', shareType: 'text', mimeType: 'text/plain' }],
      resolvedSharedPayloads: [],
      isResolving: false,
      error: null,
    };
    const onComplete = jest.fn();

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<ShareReceiveRedirector onComplete={onComplete} />);
    });
    await flush();
    act(() => {
      advanceShare({ isResolving: true });
    });
    await flush();
    act(() => {
      advanceShare({
        isResolving: false,
        resolvedSharedPayloads: [
          { value: 'hi', shareType: 'text', mimeType: 'text/plain', contentUri: null },
        ],
      });
    });
    await flush();
    expect(mockStageText).toHaveBeenCalledTimes(1);

    // 同一 intent 引起的额外渲染不触发第二次转存
    act(() => {
      renderer.update(<ShareReceiveRedirector onComplete={onComplete} />);
    });
    await flush();
    expect(mockStageText).toHaveBeenCalledTimes(1);
    expect(mockOpenShareSheet).toHaveBeenCalledTimes(1);
  });

  it('挂载时无分享内容直接结束,不转存不导航', async () => {
    const onComplete = jest.fn();

    act(() => {
      TestRenderer.create(<ShareReceiveRedirector onComplete={onComplete} />);
    });
    await flush();

    expect(mockStageText).not.toHaveBeenCalled();
    expect(mockStageAsset).not.toHaveBeenCalled();
    expect(mockOpenShareSheet).not.toHaveBeenCalled();
    expect(mockClearSharedPayloads).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
