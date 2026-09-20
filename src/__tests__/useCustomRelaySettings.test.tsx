import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { refreshCustomRelays } from '@/features/relaySettings';
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
let currentHook: ReturnType<typeof useCustomRelaySettings>;

function Harness() {
  currentHook = useCustomRelaySettings();
  return null;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('retries a failed legacy migration on refresh and clears the cache only after success', async () => {
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
