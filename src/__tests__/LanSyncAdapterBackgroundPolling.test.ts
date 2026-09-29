import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type TimerCallback = () => void;

const mockNativeTimers = new Map<string, { callback: TimerCallback; intervalMs: number }>();
let mockNextTag = 0;

jest.mock('native-timer', () => ({
  setTimer: jest.fn((callback: TimerCallback, intervalMs: number) => {
    const tag = `native_${++mockNextTag}`;
    mockNativeTimers.set(tag, { callback, intervalMs });
    return tag;
  }),
  clearTimer: jest.fn((tag: string) => {
    mockNativeTimers.delete(tag);
  }),
}));

import { LanSyncAdapter } from '../features/lan-sync/internal/lanSyncAdapter';

const profile = {
  name: 'Desk',
  urls: ['http://desk.local:42720'],
  username: 'mobile',
  password: 'secret',
  allowInsecureTls: false,
};

function activeIntervals(): number[] {
  return [...mockNativeTimers.values()].map(({ intervalMs }) => intervalMs);
}

async function tickNativeTimers(): Promise<void> {
  for (const { callback } of [...mockNativeTimers.values()]) callback();
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function createAdapter() {
  const client = {
    getClipboard: jest.fn(async () => null),
    putClipboard: jest.fn(async () => ({ url: profile.urls[0] })),
    downloadPayload: jest.fn(),
    subscribeClipboardEvents: jest.fn(() => () => undefined),
  };
  const adapter = new LanSyncAdapter({
    getServer: async () => profile,
    readClipboard: async () => null,
    applyRemoteContent: async () => undefined,
    preparePayloadTempUri: jest.fn(() => 'file:///tmp/payload'),
    client,
  });
  return { adapter, client };
}

describe('LanSyncAdapter background polling', () => {
  beforeEach(() => {
    mockNativeTimers.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('polls on the native timer while backgrounded so Android keeps receiving', async () => {
    const jsInterval = jest.spyOn(globalThis, 'setInterval');
    const { adapter, client } = createAdapter();
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: true },
    });

    adapter.handleAppStateChange({ appState: 'background', backgroundSyncEnabled: true });
    expect(activeIntervals()).toEqual([15000]);
    expect(jsInterval).not.toHaveBeenCalled();

    const pullsBefore = client.getClipboard.mock.calls.length;
    await tickNativeTimers();
    await tickNativeTimers();
    expect(client.getClipboard.mock.calls.length).toBe(pullsBefore + 2);

    adapter.handleAppStateChange({ appState: 'active', backgroundSyncEnabled: true });
    expect(activeIntervals()).toEqual([2000]);

    await adapter.stop();
    expect(activeIntervals()).toEqual([]);
  });

  it('does not poll in the background when background sync is disabled', async () => {
    const { adapter } = createAdapter();
    await adapter.start({
      appVersion: '2.0.0',
      profileId: 'default',
      policy: { appState: 'active', backgroundSyncEnabled: false },
    });

    adapter.handleAppStateChange({ appState: 'background', backgroundSyncEnabled: false });
    expect(activeIntervals()).toEqual([]);

    await adapter.stop();
  });
});
