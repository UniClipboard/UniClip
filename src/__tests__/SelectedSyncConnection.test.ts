import { describe, expect, it, jest } from '@jest/globals';
import {
  deriveP2pConnectionStatus,
  refreshSelectedConnection,
} from '@/services/SelectedSyncConnection';

describe('selected sync connection', () => {
  it.each([
    ['starting', 'idle', 'connecting'],
    ['running', 'idle', 'connecting'],
    ['running', 'connecting', 'connecting'],
    ['running', 'online', 'online'],
    ['running', 'offline', 'offline'],
    ['quiescing', 'online', 'connecting'],
    ['quiesced', 'online', 'connecting'],
    ['suspended', 'online', 'offline'],
    ['shuttingDown', 'online', 'offline'],
    ['stopped', 'online', 'offline'],
    ['failed', 'online', 'error'],
  ] as const)('maps P2P engine state %s and peer state %s to %s', (state, peerState, expected) => {
    expect(deriveP2pConnectionStatus(state, peerState, true)).toBe(expected);
  });

  it('reports P2P as unconfigured after the device leaves its space', () => {
    expect(deriveP2pConnectionStatus('running', 'online', false)).toBe('unconfigured');
  });

  it.each(['p2p', 'lan'] as const)('refreshes only the selected %s connection', async (channel) => {
    const refreshP2p = jest.fn(async () => undefined);
    const refreshLan = jest.fn(async () => undefined);

    await refreshSelectedConnection(channel, { refreshP2p, refreshLan });

    expect(refreshP2p).toHaveBeenCalledTimes(channel === 'p2p' ? 1 : 0);
    expect(refreshLan).toHaveBeenCalledTimes(channel === 'lan' ? 1 : 0);
  });
});
