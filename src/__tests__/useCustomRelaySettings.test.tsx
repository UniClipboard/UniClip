import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { refreshCustomRelays, saveCustomRelay, type CustomRelay } from '@/features/relaySettings';
import { useCustomRelaySettings } from '@/screens/settings/useCustomRelaySettings';

const mockUpdateConfig = jest.fn().mockResolvedValue(undefined);

jest.mock('@/features/relaySettings', () => ({
  refreshCustomRelays: jest.fn(),
  saveCustomRelay: jest.fn(),
}));

jest.mock('@/stores', () => ({
  useSettingsStore: (selector: (state: object) => unknown) =>
    selector({
      config: { customRelayUrls: ['https://legacy.example.com'] },
      updateConfig: mockUpdateConfig,
    }),
}));

const mockedRefresh = jest.mocked(refreshCustomRelays);
const mockedSave = jest.mocked(saveCustomRelay);
let currentHook: ReturnType<typeof useCustomRelaySettings>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function Harness() {
  currentHook = useCustomRelaySettings();
  return null;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('retries a failed legacy migration on refresh and clears the cache only after success', async () => {
  mockedRefresh.mockReset();
  mockedSave.mockReset();
  mockUpdateConfig.mockClear();
  const relays = [{ url: 'https://legacy.example.com', credentialConfigured: false }];
  mockedRefresh.mockRejectedValueOnce(new Error('not confirmed')).mockResolvedValue(relays);

  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<Harness />);
  });

  try {
    expect(currentHook.initialRefreshFailed).toBe(true);
    expect(mockedRefresh).toHaveBeenNthCalledWith(1, ['https://legacy.example.com']);
    expect(mockUpdateConfig).not.toHaveBeenCalled();

    await act(async () => {
      await currentHook.refresh();
    });

    expect(mockedRefresh).toHaveBeenNthCalledWith(2, ['https://legacy.example.com']);
    expect(mockUpdateConfig).toHaveBeenCalledWith({ customRelayUrls: [] });
    expect(currentHook.initialRefreshFailed).toBe(false);
    expect(currentHook.relays).toEqual(relays);

    await act(async () => {
      await currentHook.refresh();
    });
    expect(mockedRefresh).toHaveBeenNthCalledWith(3, []);
  } finally {
    act(() => view.unmount());
  }
});

it('does not let an older initial refresh overwrite a newer save', async () => {
  mockedRefresh.mockReset();
  mockedSave.mockReset();
  mockUpdateConfig.mockClear();
  const initial = deferred<CustomRelay[]>();
  const saved = [{ url: 'https://saved.example.com', credentialConfigured: false }];
  mockedRefresh.mockReturnValueOnce(initial.promise);
  mockedSave.mockResolvedValue({ relays: saved, connection: Promise.resolve('rebuilt') });

  let view!: TestRenderer.ReactTestRenderer;
  act(() => {
    view = TestRenderer.create(<Harness />);
  });

  try {
    await act(async () => {
      await currentHook.save({ url: saved[0].url, accessToken: '' });
    });
    expect(currentHook.relays).toEqual(saved);

    await act(async () => {
      initial.resolve([{ url: 'https://stale.example.com', credentialConfigured: false }]);
      await initial.promise;
    });
    expect(currentHook.relays).toEqual(saved);
  } finally {
    act(() => view.unmount());
  }
});

it('does not let an older explicit refresh overwrite a newer save', async () => {
  mockedRefresh.mockReset();
  mockedSave.mockReset();
  mockUpdateConfig.mockClear();
  mockedRefresh.mockResolvedValueOnce([]);
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<Harness />);
  });

  try {
    const refresh = deferred<CustomRelay[]>();
    const saved = [{ url: 'https://saved.example.com', credentialConfigured: false }];
    mockedRefresh.mockReturnValueOnce(refresh.promise);
    mockedSave.mockResolvedValue({ relays: saved, connection: Promise.resolve('rebuilt') });
    let refreshPromise!: Promise<CustomRelay[]>;
    act(() => {
      refreshPromise = currentHook.refresh();
    });
    await act(async () => {
      await currentHook.save({ url: saved[0].url, accessToken: '' });
    });

    await act(async () => {
      refresh.resolve([{ url: 'https://stale.example.com', credentialConfigured: false }]);
      await refreshPromise;
    });
    expect(currentHook.relays).toEqual(saved);
  } finally {
    act(() => view.unmount());
  }
});

it('does not let save-failure recovery overwrite a newer refresh', async () => {
  mockedRefresh.mockReset();
  mockedSave.mockReset();
  mockUpdateConfig.mockClear();
  mockedRefresh.mockResolvedValueOnce([]);
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<Harness />);
  });

  try {
    const recovery = deferred<CustomRelay[]>();
    const latest = [{ url: 'https://latest.example.com', credentialConfigured: false }];
    mockedSave.mockRejectedValueOnce(new Error('save failed'));
    mockedRefresh.mockReturnValueOnce(recovery.promise).mockResolvedValueOnce(latest);
    let savePromise!: Promise<unknown>;
    await act(async () => {
      savePromise = currentHook.save({ url: 'https://failed.example.com', accessToken: '' }).catch(
        (error) => error
      );
      await Promise.resolve();
    });
    let refreshPromise!: Promise<CustomRelay[]>;
    act(() => {
      refreshPromise = currentHook.refresh();
    });
    await act(async () => {
      recovery.resolve([{ url: 'https://stale.example.com', credentialConfigured: false }]);
      await Promise.all([savePromise, refreshPromise]);
    });
    expect(currentHook.relays).toEqual(latest);
  } finally {
    act(() => view.unmount());
  }
});

it('recovers a failed later save after an earlier in-flight save settles', async () => {
  mockedRefresh.mockReset();
  mockedSave.mockReset();
  mockUpdateConfig.mockClear();
  mockedRefresh.mockResolvedValueOnce([]);
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<Harness />);
  });

  try {
    const firstSave = deferred<ReturnType<typeof currentHook.save> extends Promise<infer T> ? T : never>();
    const saved = [{ url: 'https://saved.example.com', credentialConfigured: false }];
    let firstSaveSettled = false;
    const recoveryTiming: boolean[] = [];
    mockedSave
      .mockReturnValueOnce(
        firstSave.promise.then((result) => {
          firstSaveSettled = true;
          return result;
        })
      )
      .mockRejectedValueOnce(new Error('second save failed'));
    mockedRefresh.mockImplementation(async () => {
      recoveryTiming.push(firstSaveSettled);
      return firstSaveSettled ? saved : [];
    });

    let earlier!: Promise<unknown>;
    let later!: Promise<unknown>;
    act(() => {
      earlier = currentHook.save({ url: saved[0].url, accessToken: '' });
      later = currentHook
        .save({ url: 'https://failed.example.com', accessToken: '' })
        .catch((error) => error);
    });
    await act(async () => {
      firstSave.resolve({ relays: saved, connection: Promise.resolve('rebuilt') });
      await Promise.all([earlier, later]);
    });

    expect(recoveryTiming).toEqual([true]);
    expect(currentHook.relays).toEqual(saved);
  } finally {
    act(() => view.unmount());
  }
});

it('refreshes only after a save that was already in flight settles', async () => {
  mockedRefresh.mockReset();
  mockedSave.mockReset();
  mockUpdateConfig.mockClear();
  mockedRefresh.mockResolvedValueOnce([]);
  let view!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    view = TestRenderer.create(<Harness />);
  });

  try {
    const pendingSave = deferred<ReturnType<typeof currentHook.save> extends Promise<infer T> ? T : never>();
    const saved = [{ url: 'https://saved.example.com', credentialConfigured: false }];
    let saveSettled = false;
    mockedSave.mockReturnValueOnce(
      pendingSave.promise.then((result) => {
        saveSettled = true;
        return result;
      })
    );
    mockedRefresh.mockImplementation(async () => (saveSettled ? saved : []));

    let savePromise!: Promise<unknown>;
    let refreshPromise!: Promise<CustomRelay[]>;
    act(() => {
      savePromise = currentHook.save({ url: saved[0].url, accessToken: '' });
      refreshPromise = currentHook.refresh();
    });
    let refreshResult!: CustomRelay[];
    await act(async () => {
      pendingSave.resolve({ relays: saved, connection: Promise.resolve('rebuilt') });
      await savePromise;
      refreshResult = await refreshPromise;
    });

    expect(refreshResult).toEqual(saved);
    expect(currentHook.relays).toEqual(saved);
  } finally {
    act(() => view.unmount());
  }
});
