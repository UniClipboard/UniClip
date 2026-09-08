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
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { PendingShareJob } from '@/features/transfer';
import { useUnifiedSpaceStore } from '@/features/space/store';

const mockClaimPending = jest.fn();
const mockCompleteJob = jest.fn(async () => undefined);
const mockReleaseJob = jest.fn(async () => undefined);
const mockCleanup = jest.fn(async () => undefined);

const mockSendImportedText = jest.fn();
const mockSendImportedAsset = jest.fn();
const mockImportTextToHistory = jest.fn();
const mockImportFileToHistory = jest.fn();
const mockRecordShareDiagnosticStage = jest.fn();
let mockSyncChannel: 'lan' | 'p2p' = 'p2p';
let mockLanServers: Array<{
  id: string;
  name: string;
  address: string;
  status: 'checking' | 'online' | 'authFailed' | 'offline';
}> = [];

jest.mock('@/features/settings', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) =>
    selector({ config: { syncChannel: mockSyncChannel } }),
}));

jest.mock('@/components/useLanMySpaceSheet', () => ({
  useLanMySpaceSheet: () => ({
    servers: mockLanServers,
    isRefreshing: false,
    refresh: jest.fn(),
    isUnconfigured: mockLanServers.length === 0,
  }),
}));

jest.mock('@/features/transfer', () => ({
  getOutboundShareHandoffManager: () => ({
    claimPending: (...args: unknown[]) => mockClaimPending(...args),
    completeJob: (...args: unknown[]) => mockCompleteJob(...args),
    releaseJob: (...args: unknown[]) => mockReleaseJob(...args),
  }),
  createPendingShareStore: () => ({
    cleanup: (...args: unknown[]) => mockCleanup(...args),
  }),
}));

jest.mock('@/features/sync', () => ({
  getUnifiedSyncRuntime: () => ({
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

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success' },
  notificationAsync: jest.fn(async () => undefined),
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

function Harness({ onClose, active = true, jobs }: { onClose: () => void; active?: boolean; jobs?: PendingShareJob[] }) {
  const c = useShareSendController(onClose, active, jobs);
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
  it('loads app-provided files without claiming or clearing external shares', async () => {
    const onClose = jest.fn();
    act(() => {
      renderedHarnesses.push(TestRenderer.create(<Harness onClose={onClose} jobs={[imageJob]} />));
    });
    await settle();
    expect(current.jobViews.map((view) => view.job)).toEqual([imageJob]);
    expect(mockClaimPending).not.toHaveBeenCalled();
    act(() => current.handleClose());
    expect(mockCompleteJob).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('copies an app-provided ZIP into history and retries failed delivery without clearing the queue', async () => {
    const job = { ...staleJob, id: 'diagnostics', createdAtMs: Date.now() };
    const onClose = jest.fn();
    mockSendImportedAsset.mockResolvedValueOnce({ success: false, state: 'failed' });
    act(() => {
      renderedHarnesses.push(TestRenderer.create(<Harness onClose={onClose} jobs={[job]} />));
    });
    await settle();
    act(() => current.toggleTarget('desktop-1'));
    await act(async () => { await current.sendAll(); });
    expect(current.jobViews[0].sendState).toBe('failed');
    expect(onClose).not.toHaveBeenCalled();
    expect(mockImportFileToHistory).toHaveBeenCalledWith(
      job.fileUri, job.displayName, job.mimeType, job.byteCount,
      { skipInitialCopyOnIOS: false }
    );
    await act(async () => { await current.retryJob(job.id); });
    expect(current.jobViews[0].sendState).toBe('success');
    expect(mockSendImportedAsset).toHaveBeenLastCalledWith(
      expect.objectContaining({ uri: 'file:///documents/clipboards/history/file' }),
      'HASH-F', { targetIds: ['desktop-1'] }
    );
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  it('keeps app-provided files owned by the parent while a send is in progress', async () => {
    let finish!: (result: { success: boolean; state: string }) => void;
    mockSendImportedAsset.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onClose = jest.fn();
    act(() => {
      renderedHarnesses.push(TestRenderer.create(<Harness onClose={onClose} jobs={[imageJob]} />));
    });
    await settle();
    act(() => current.toggleTarget('desktop-1'));
    let sending!: Promise<void>;
    await act(async () => { sending = current.sendAll(); await flush(); });
    act(() => current.handleClose());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { finish({ success: false, state: 'failed' }); await sending; });
    act(() => current.handleClose());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });

  afterEach(() => {
    act(() => {
      renderedHarnesses.forEach((renderer) => renderer.unmount());
    });
    renderedHarnesses = [];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncChannel = 'p2p';
    mockLanServers = [];
    mockClaimPending.mockResolvedValue([]);
    mockSendImportedText.mockResolvedValue({ success: true, state: 'delivered' });
    mockSendImportedAsset.mockResolvedValue({ success: true, state: 'delivered' });
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
      current.toggleTarget('desktop-1');
    });
    expect(current.canSend).toBe(true);
    act(() => {
      current.toggleTarget('desktop-1');
    });
    expect(current.canSend).toBe(false);
  });

  it('keeps remote device order when connection status changes', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    useUnifiedSpaceStore.setState({
      devices: [
        { deviceId: 'local', displayName: 'Phone', isLocal: true, online: true },
        { deviceId: 'first', displayName: 'iPad', isLocal: false, online: false },
        { deviceId: 'second', displayName: 'MacBook', isLocal: false, online: false },
      ],
    });

    renderHarness(jest.fn());
    await settle();

    act(() => {
      useUnifiedSpaceStore.setState({
        devices: [
          { deviceId: 'local', displayName: 'Phone', isLocal: true, online: true },
          { deviceId: 'first', displayName: 'iPad', isLocal: false, online: false },
          { deviceId: 'second', displayName: 'MacBook', isLocal: false, online: true },
        ],
      });
    });

    expect(current.targets.map((target) => target.id)).toEqual(['first', 'second']);
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

    expect([...current.selectedTargetIds]).toEqual(['desktop']);
    expect(current.canSend).toBe(true);
  });

  it('shows only reachable LAN servers and sends to every selected server', async () => {
    mockSyncChannel = 'lan';
    mockLanServers = [
      {
        id: 'home',
        name: 'Home Mac',
        address: 'http://home.local:42720',
        status: 'online',
      },
      {
        id: 'office',
        name: 'Office Mac',
        address: 'https://office.local:42720',
        status: 'authFailed',
      },
      {
        id: 'studio',
        name: 'Studio PC',
        address: 'http://studio.local:42720',
        status: 'online',
      },
    ];
    mockClaimPending.mockResolvedValue([textJob]);

    renderHarness(jest.fn());
    await settle();

    expect(current.targetKind).toBe('server');
    expect(current.targets).toEqual([
      { id: 'home', displayName: 'Home Mac', detail: 'http://home.local:42720' },
      { id: 'studio', displayName: 'Studio PC', detail: 'http://studio.local:42720' },
    ]);
    expect(mockRefreshDevices).not.toHaveBeenCalled();

    act(() => {
      current.toggleTarget('home');
      current.toggleTarget('studio');
    });
    await act(async () => current.sendAll());

    expect(mockSendImportedText).toHaveBeenCalledWith('hello world', 'HASH-T', {
      targetIds: ['home', 'studio'],
    });
  });

  it('keeps LAN send disabled when no configured server is reachable', async () => {
    mockSyncChannel = 'lan';
    mockLanServers = [
      {
        id: 'office',
        name: 'Office Mac',
        address: 'https://office.local:42720',
        status: 'offline',
      },
    ];
    mockClaimPending.mockResolvedValue([textJob]);

    renderHarness(jest.fn());
    await settle();

    expect(current.targetKind).toBe('server');
    expect(current.targets).toEqual([]);
    expect(current.selectedTargetIds.size).toBe(0);
    expect(current.canSend).toBe(false);
  });

  it('sends text jobs through history import and completes them on delivery', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    renderHarness(jest.fn());
    await settle();
    act(() => {
      current.toggleTarget('desktop-1');
    });

    await act(async () => {
      await current.sendAll();
    });

    expect(mockImportTextToHistory).toHaveBeenCalledWith('hello world');
    expect(mockSendImportedText).toHaveBeenCalledWith('hello world', 'HASH-T', {
      targetIds: ['desktop-1'],
    });
    expect(mockRecordShareDiagnosticStage).toHaveBeenCalledWith('text-1', 'sent', undefined);
    expect(mockCompleteJob).toHaveBeenCalledWith('text-1');
    expect(current.jobViews[0].sendState).toBe('success');
    expect(current.phase.kind).toBe('done');
  });

  it('shows success feedback and closes the sheet 600ms after every job is delivered', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    const onClose = jest.fn();
    renderHarness(onClose);
    await settle();
    act(() => {
      current.toggleTarget('desktop-1');
    });

    jest.useFakeTimers();
    try {
      await act(async () => {
        await current.sendAll();
      });

      expect(Haptics.notificationAsync).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Success
      );
      expect(current.phase.kind).toBe('done');
      expect(onClose).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(599);
      });
      expect(onClose).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends image jobs to the selected devices and completes them', async () => {
    mockClaimPending.mockResolvedValue([imageJob]);
    renderHarness(jest.fn());
    await settle();
    act(() => {
      current.toggleTarget('desktop-1');
      current.toggleTarget('laptop-1');
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
      { targetIds: ['desktop-1', 'laptop-1'] }
    );
    expect(mockCompleteJob).toHaveBeenCalledWith('image-1');
  });

  it('keeps failed jobs claimable and lets the user retry them', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    mockSendImportedText.mockResolvedValue({ success: false, state: 'offline' });
    renderHarness(jest.fn());
    await settle();
    act(() => {
      current.toggleTarget('desktop-1');
    });

    await act(async () => {
      await current.sendAll();
    });

    expect(mockCompleteJob).not.toHaveBeenCalled();
    expect(mockRecordShareDiagnosticStage).toHaveBeenCalledWith('text-1', 'failed', 'offline');
    expect(current.jobViews[0].sendState).toBe('failed');

    // 重试:不重新认领,同一 job 重新发送
    mockSendImportedText.mockResolvedValue({ success: true, state: 'delivered' });
    await act(async () => {
      await current.retryJob('text-1');
    });
    expect(mockClaimPending).toHaveBeenCalledTimes(1);
    expect(mockCompleteJob).toHaveBeenCalledWith('text-1');
    expect(current.jobViews[0].sendState).toBe('success');
  });

  it('explains when the selected device is offline', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    mockSendImportedText.mockResolvedValue({ success: false, state: 'offline' });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    renderHarness(jest.fn());
    await settle();
    act(() => {
      current.toggleTarget('laptop-1');
    });

    await act(async () => {
      await current.sendAll();
    });

    expect(alert).toHaveBeenCalledWith('send.offlineTitle', 'send.offline');
    alert.mockRestore();
  });

  it('keeps a partially delivered job retryable instead of marking it complete', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    mockSendImportedText.mockResolvedValue({ success: true, state: 'partial' });
    renderHarness(jest.fn());
    await settle();
    act(() => {
      current.toggleTarget('desktop-1');
    });

    await act(async () => {
      await current.sendAll();
    });

    expect(mockCompleteJob).not.toHaveBeenCalled();
    expect(mockRecordShareDiagnosticStage).toHaveBeenCalledWith('text-1', 'failed', 'partial');
    expect(current.jobViews[0].sendState).toBe('failed');
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
    mockSendImportedAsset.mockResolvedValue({ success: false, state: 'offline' });
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

  it('completes unsent jobs on close after Android staged content is saved', async () => {
    mockClaimPending.mockResolvedValue([textJob]);
    const onClose = jest.fn();
    renderHarness(onClose);
    await settle();

    act(() => {
      current.handleClose();
    });

    expect(mockReleaseJob).not.toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalledWith('text-1');
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

  it('clears stale Android jobs because their content has already been saved', async () => {
    mockClaimPending.mockResolvedValue([textJob, staleJob]);
    renderHarness(jest.fn());
    await settle();

    expect(mockCompleteJob).toHaveBeenCalledWith('stale-1');
    expect(current.jobViews.map((v) => v.job.id)).toEqual(['text-1']);
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
