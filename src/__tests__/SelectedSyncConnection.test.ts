import { describe, expect, it, jest } from '@jest/globals';
import {
  deriveP2pConnectionStatus,
  refreshSelectedConnection,
} from '@/services/SelectedSyncConnection';

describe('selected sync connection', () => {
  it.each([
    ['starting', 'connecting'],
    ['running', 'online'],
    ['quiescing', 'connecting'],
    ['quiesced', 'connecting'],
    ['suspended', 'offline'],
    ['shuttingDown', 'offline'],
    ['stopped', 'offline'],
    ['failed', 'error'],
  ] as const)('maps P2P engine state %s to %s', (state, expected) => {
    expect(deriveP2pConnectionStatus(state, true)).toBe(expected);
  });

  it('reports P2P as unconfigured after the device leaves its space', () => {
    expect(deriveP2pConnectionStatus('running', false)).toBe('unconfigured');
  });

  it.each(['p2p', 'lan'] as const)('refreshes only the selected %s connection', async (channel) => {
    const refreshP2p = jest.fn(async () => undefined);
    const refreshLan = jest.fn(async () => undefined);

    await refreshSelectedConnection(channel, { refreshP2p, refreshLan });

    expect(refreshP2p).toHaveBeenCalledTimes(channel === 'p2p' ? 1 : 0);
    expect(refreshLan).toHaveBeenCalledTimes(channel === 'lan' ? 1 : 0);
  });
});
