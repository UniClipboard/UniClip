import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useSpacePageRefresh } from '@/components/useSpacePageRefresh';
import {
  createInitialUnifiedEngineSnapshot,
  useUnifiedEngineStore,
} from '@/stores/unifiedEngineStore';

const mockRefresh = jest.fn();
jest.mock('@/features/space', () => ({
  getUnifiedSpaceService: () => ({ refresh: mockRefresh }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('space page refresh during transport switching', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  let state: ReturnType<typeof useSpacePageRefresh>;
  function Page() {
    state = useSpacePageRefresh();
    return null;
  }
  beforeEach(() => {
    useUnifiedEngineStore.setState(createInitialUnifiedEngineSnapshot(), true);
    mockRefresh.mockReset().mockResolvedValue({});
  });
  afterEach(() => act(() => renderer.unmount()));
  async function mount() {
    await act(async () => {
      renderer = TestRenderer.create(<Page />);
    });
  }
  async function start() {
    await act(async () => useUnifiedEngineStore.setState({ isStarted: true, status: 'running' }));
  }

  it('does not query a stopped or starting engine and refreshes once it is ready', async () => {
    await mount();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(state!.waiting).toBe(true);
    await act(async () => useUnifiedEngineStore.setState({ status: 'starting' }));
    expect(mockRefresh).not.toHaveBeenCalled();
    await start();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(state!.error).toBeNull();
    expect(state!.waiting).toBe(false);
  });

  it('ignores an old failed query after stopping and restarting', async () => {
    let rejectOld!: (error: Error) => void;
    mockRefresh.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        })
    );
    await mount();
    await start();
    await act(async () => useUnifiedEngineStore.setState({ isStarted: false, status: 'stopped' }));
    await start();
    await act(async () => rejectOld(new Error('Engine not started')));
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(state!.error).toBeNull();
  });

  it('shows a real query failure and clears it after retry succeeds', async () => {
    const failure = new Error('Query failed');
    mockRefresh.mockRejectedValueOnce(failure);
    await mount();
    await start();
    expect(state!.error).toBe(failure);
    await act(async () => state!.refresh());
    expect(state!.error).toBeNull();
  });

  it('shows startup failure without querying the stopped engine', async () => {
    await mount();
    await act(async () =>
      useUnifiedEngineStore.setState({ status: 'failed', lastError: 'Start failed' })
    );
    expect(state!.waiting).toBe(false);
    expect(state!.error).toEqual(new Error('Start failed'));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
