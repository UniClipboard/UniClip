/**
 * useShareSendController 状态机测试(§11.1)
 *
 * 用 Harness 渲染 hook,验证:
 * - 挂载认领(单次认领守卫)与认领失败重试;
 * - 空设备禁用发送;
 * - 发送成功 → completeJob;失败 → 保留 + 可重试;
 * - 删除 → completeJob 并清除;
 * - 取消/完成 → 未发送 job releaseJob 后返回。
 */
import React, { useEffect, useRef } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { PendingShareJob } from '@/features/transfer';
import { useUnifiedSpaceStore } from '@/features/space/store';

const mockClaimPending = jest.fn();
const mockCompleteJob = jest.fn(async () => undefined);
const mockReleaseJob = jest.fn(async () => undefined);
const mockCleanup = jest.fn(async () => undefined);
/** 模拟 PendingShareStore 的 contentPersistedOnStage 能力(iOS true / Android false)。 */
let mockContentPersistedOnStage = true;

const mockSendImportedText = jest.fn();
const mockSendImportedAsset = jest.fn();
const mockImportTextToHistory = jest.fn();
const mockImportFileToHistory = jest.fn();
const mockRecordShareDiagnosticStage = jest.fn();

jest.mock('@/features/transfer', () => ({
  getOutboundShareHandoffManager: () => ({
    claimPending: (...args: unknown[]) => mockClaimPending(...args),
    completeJob: (...args: unknown[]) => mockCompleteJob(...args),
    releaseJob: (...args: unknown[]) => mockReleaseJob(...args),
  }),
  createPendingShareStore: () => ({
    cleanup: (...args: unknown[]) => mockCleanup(...args),
    contentPersistedOnStage: mockContentPersistedOnStage,
  }),
  getUnifiedContentService: () => ({
    sendImportedText: (...args: unknown[]) => mockSendImportedText(...args),
    sendImportedAsset: (...args: unknown[]) => mockSendImportedAsset(...args),
  }),
}));

jest.mock('@/utils/uploadFile', () => ({
  importTextToHistory: (...args: unknown[]) => mockImportTextToHistory(...args),
  importFileToHistory: (...args: unknown[]) => mockImportFileToHistory(...args),
}));

jest.mock('app-group-store', () => ({
  recordShareDiagnosticStage: (...args: unknown[]) => mockRecordShareDiagnosticStage(...args),
}));

jest.mock('@/support/observability', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockRefreshDevices = jest.fn(async () => ({ devices: [] }));
jest.mock('@/features/space', () => ({
  ...jest.requireActual('@/features/space/store'),
  getUnifiedSpaceService: () => ({ refreshDevices: () => mockRefreshDevices() }),
}));

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    constructor(...parts: Array<{ uri: string } | string>) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('/')
        .replace(/\/+/g, '/');
    }
    async text() {
      return this.uri.includes('text-1') ? 'hello world' : '';
    }
  }
  return {
    File: MockFile,
    Directory: class {},
    Paths: { document: 'file:///documents', cache: 'file:///cache' },
  };
});

// t 保持模块级稳定引用(与真实 i18next 一致),避免 controller 的
// useCallback 依赖随每次渲染变化导致 effect 无限重跑。
const stableT = (key: string) => key;
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT }),
}));

import { useShareSendController } from '@/components/ShareSendSheet/useShareSendController';

const textJob: PendingShareJob = {
  id: 'text-1',
  kind: 'text',
  displayName: '分享的文本.txt',
  byteCount: 11,
  mimeType: 'text/plain',
  fileUri: 'file:///documents/pending-share/files/text-1.payload',
  createdAtMs: Date.now(),
};
const imageJob: PendingShareJob = {
  id: 'image-1',
  kind: 'image',
  displayName: 'pic.jpg',
  byteCount: 100,
  mimeType: 'image/jpeg',
  fileUri: 'file:///documents/pending-share/files/image-1.payload',
  createdAtMs: Date.now(),
};
const staleJob: PendingShareJob = {
  id: 'stale-1',
  kind: 'file',
  displayName: 'old.zip',
  byteCount: 5,
  mimeType: 'application/zip',
  fileUri: 'file:///documents/pending-share/files/stale-1.payload',
  createdAtMs: Date.now() - 16 * 60 * 1_000,
};

type ControllerState = ReturnType<typeof useShareSendController>;

let current!: ControllerState;
let renderedHarnesses: TestRenderer.ReactTestRenderer[] = [];

function Harness({ onClose, active = true }: { onClose: () => void; active?: boolean }) {
  const c = useShareSendController(onClose, active);
  const ref = useRef<ControllerState | null>(null);
  ref.current = c;
  useEffect(() => {
    current = c;
  });
  return null;
}

function renderHarness(onClose: () => void, active = true) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Harness onClose={onClose} active={active} />);
  });
  renderedHarnesses.push(renderer);
  return renderer;
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

// React 19 act 语义:act 之外的异步 setState 不会立即 flush,
// 用 act(async) 包裹 microtask 循环,结算异步 effect 链。
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};

describe('useShareSendController', () => {
  afterEach(() => {
    act(() => {
      renderedHarnesses.forEach((renderer) => renderer.unmount());
    });
    renderedHarnesses = [];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockContentPersistedOnStage = true;
    mockClaimPending.mockResolvedValue([]);
    mockSendImportedText.mockResolvedValue({ success: true, deliveryState: 'delivered' });
    mockSendImportedAsset.mockResolvedValue({ success: true, deliveryState: 'delivered' });
    mockImportTextToHistory.mockResolvedValue({ profileHash: 'HASH-T' });
    mockImportFileToHistory.mockResolvedValue({
      profileHash: 'HASH-F',
      fileUri: 'file:///documents/clipboards/history/file',
      fileName: 'pic.jpg',
      fileSize: 100,
      contentType: 'Image',
    });
    useUnifiedSpaceStore.setState({
      devices: [
        { deviceId: 'local', displayName: 'Phone', isLocal: true, online: true },
        { deviceId: 'desktop-1', displayName: 'Desktop', isLocal: false, online: true },
        { deviceId: 'laptop-1', displayName: 'Laptop', isLocal: false, online: false },
      ],
    });
  });

  it('claims pending jobs on mount (single claim) and previews text payloads', async () => {
    mockClaimPending.mockResolvedValue([textJob, imageJob]);
    const renderer = renderHarness(jest.fn());
    await settle();

    expect(mockCleanup).toHaveBeenCalledTimes(1);
    expect(mockRefreshDevices).toHaveBeenCalledTimes(1);
    expect(mockClaimPending).toHaveBeenCalledTimes(1);
    expect(current.phase.kind).toBe('ready');
    expect(current.jobViews).toHaveLength(2);
    const textView = current.jobViews.find((v) => v.job.id === 'text-1');
    expect(textView?.previewText).toBe('hello world');
    expect(textView?.sendState).toBe('idle');

    // 重复渲染不重复认领(claimedRef 守卫)
    act(() => {
      renderer.update(<Harness onClose={jest.fn()} />);
    });
    await flush();
    expect(mockClaimPending).toHaveBeenCalledTimes(1);
  });

  it('keeps send disabled until at least one device is selected', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    renderHarness(jest.fn());
    await settle();

    expect(current.canSend).toBe(false);
    act(() => {
      current.toggleDevice('desktop-1');
    });
    expect(current.canSend).toBe(true);
    act(() => {
      current.toggleDevice('desktop-1');
    });
    expect(current.canSend).toBe(false);
  });

  it('shows remote devices online first and omits the local device', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    useUnifiedSpaceStore.setState({
      devices: [
        { deviceId: 'local', displayName: 'Phone', isLocal: true, online: true },
        { deviceId: 'offline', displayName: 'iPad', isLocal: false, online: false },
        { deviceId: 'online', displayName: 'MacBook', isLocal: false, online: true },
      ],
    });

    renderHarness(jest.fn());
    await settle();

    expect(current.devices.map((device) => device.deviceId)).toEqual(['online', 'offline']);
  });

  it('preselects the only remote device for a new share session', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    useUnifiedSpaceStore.setState({
      devices: [
        { deviceId: 'local', displayName: 'Phone', isLocal: true, online: true },
        { deviceId: 'desktop', displayName: 'Desktop', isLocal: false, online: true },
      ],
    });

    renderHarness(jest.fn());
    await settle();

    expect([...current.selectedDeviceIds]).toEqual(['desktop']);
    expect(current.canSend).toBe(true);
  });

  it('sends text jobs through history import and completes them on delivery', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    renderHarness(jest.fn());
    await settle();
    act(() => {
      current.toggleDevice('desktop-1');
    });

    await act(async () => {
      await current.sendAll();
    });

    expect(mockImportTextToHistory).toHaveBeenCalledWith('hello world');
    expect(mockSendImportedText).toHaveBeenCalledWith('hello world', 'HASH-T');
    expect(mockRecordShareDiagnosticStage).toHaveBeenCalledWith('text-1', 'sent', undefined);
    expect(mockCompleteJob).toHaveBeenCalledWith('text-1');
    expect(current.jobViews[0].sendState).toBe('success');
    expect(current.phase.kind).toBe('done');
  });

  it('sends image jobs to the selected devices and completes them', async () => {
    mockClaimPending.mockResolvedValue([imageJob]);
    renderHarness(jest.fn());
    await settle();
    act(() => {
      current.toggleDevice('desktop-1');
      current.toggleDevice('laptop-1');
    });

    await act(async () => {
      await current.sendAll();
    });

    expect(mockImportFileToHistory).toHaveBeenCalledWith(
      imageJob.fileUri,
      'pic.jpg',
      'image/jpeg',
      100,
      { skipInitialCopyOnIOS: false }
    );
    expect(mockSendImportedAsset).toHaveBeenCalledWith(
      {
        kind: 'image',
        uri: 'file:///documents/clipboards/history/file',
        fileName: 'pic.jpg',
        mimeType: 'image/jpeg',
      },
      'HASH-F',
      { targetDeviceIds: ['desktop-1', 'laptop-1'] }
    );
    expect(mockCompleteJob).toHaveBeenCalledWith('image-1');
  });

  it('keeps failed jobs claimable and lets the user retry them', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    mockSendImportedText.mockResolvedValue({ success: false, deliveryState: 'offline' });
    renderHarness(jest.fn());
    await settle();
    act(() => {
      current.toggleDevice('desktop-1');
    });

    await act(async () => {
      await current.sendAll();
    });

    expect(mockCompleteJob).not.toHaveBeenCalled();
    expect(mockRecordShareDiagnosticStage).toHaveBeenCalledWith('text-1', 'failed', 'offline');
    expect(current.jobViews[0].sendState).toBe('failed');

    // 重试:不重新认领,同一 job 重新发送
    mockSendImportedText.mockResolvedValue({ success: true, deliveryState: 'delivered' });
    await act(async () => {
      await current.retryJob('text-1');
    });
    expect(mockClaimPending).toHaveBeenCalledTimes(1);
    expect(mockCompleteJob).toHaveBeenCalledWith('text-1');
    expect(current.jobViews[0].sendState).toBe('success');
  });

  it('deletes a job permanently (record + payload) and removes it from the list', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    renderHarness(jest.fn());
    await settle();

    await act(async () => {
      await current.deleteJob('text-1');
    });

    expect(mockCompleteJob).toHaveBeenCalledWith('text-1');
    expect(current.jobViews).toHaveLength(0);
  });

  it('completes unsent jobs on close when staging already persisted them (iOS)', async () => {
    mockClaimPending.mockResolvedValue([textJob, imageJob]);
    // 第二个 job 发送失败(offline),保持未发送状态
    mockSendImportedAsset.mockResolvedValue({ success: false, deliveryState: 'offline' });
    const onClose = jest.fn();
    renderHarness(onClose);
    await settle();

    await act(async () => {
      await current.sendAll();
    });
    expect(current.jobViews[0].sendState).toBe('success');
    expect(current.jobViews[1].sendState).toBe('failed');

    act(() => {
      current.handleClose();
    });

    // iOS:内容已在主页历史,关闭即出队,不再放回 pending 造成堆积
    expect(mockReleaseJob).not.toHaveBeenCalled();
    // 一次来自发送成功(text-1),一次来自关闭时出队(image-1)
    expect(mockCompleteJob).toHaveBeenCalledTimes(2);
    expect(mockCompleteJob).toHaveBeenCalledWith('image-1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('releases unsent jobs on close when content lives only in the queue (Android)', async () => {
    mockContentPersistedOnStage = false;
    mockClaimPending.mockResolvedValue([textJob]);
    const onClose = jest.fn();
    renderHarness(onClose);
    await settle();

    act(() => {
      current.handleClose();
    });

    expect(mockCompleteJob).not.toHaveBeenCalled();
    expect(mockReleaseJob).toHaveBeenCalledTimes(1);
    expect(mockReleaseJob).toHaveBeenCalledWith('text-1');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sweeps stale jobs older than the processing lease on claim (iOS)', async () => {
    mockClaimPending.mockResolvedValue([textJob, staleJob]);
    renderHarness(jest.fn());
    await settle();

    // 陈旧 job 已出队,分享页只展示本次的崭新内容
    expect(mockCompleteJob).toHaveBeenCalledTimes(1);
    expect(mockCompleteJob).toHaveBeenCalledWith('stale-1');
    expect(current.jobViews.map((v) => v.job.id)).toEqual(['text-1']);
    expect(current.phase.kind).toBe('ready');
  });

  it('keeps stale jobs claimable when content is not persisted on stage (Android)', async () => {
    mockContentPersistedOnStage = false;
    mockClaimPending.mockResolvedValue([textJob, staleJob]);
    renderHarness(jest.fn());
    await settle();

    expect(mockCompleteJob).not.toHaveBeenCalled();
    expect(current.jobViews.map((v) => v.job.id)).toEqual(['text-1', 'stale-1']);
  });

  it('shows the error phase when claiming fails and retries on demand', async () => {
    mockClaimPending.mockRejectedValueOnce(new Error('store busy'));
    renderHarness(jest.fn());
    await settle();

    expect(current.phase.kind).toBe('error');

    mockClaimPending.mockResolvedValue([textJob]);
    act(() => {
      current.handleRetryClaim();
    });
    await settle();

    expect(mockClaimPending).toHaveBeenCalledTimes(2);
    expect((current.phase as { kind: 'ready' }).kind).toBe('ready');
    expect(current.jobViews).toHaveLength(1);
  });

  it('clears the claimed list when there are no pending jobs', async () => {
    mockClaimPending.mockResolvedValue([]);
    renderHarness(jest.fn());
    await settle();

    expect(current.phase.kind).toBe('ready');
    expect(current.jobViews).toHaveLength(0);
  });
});
