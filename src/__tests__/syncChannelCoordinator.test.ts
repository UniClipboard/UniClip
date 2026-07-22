import { describe, expect, it } from '@jest/globals';
import {
  SyncChannelCoordinator,
  type SyncChannelRuntime,
} from '../services/SyncChannelCoordinator';

function runtime(name: string, events: string[]): SyncChannelRuntime {
  return {
    start: async () => {
      events.push(`${name}:start`);
    },
    stop: async () => {
      events.push(`${name}:stop`);
    },
  };
}

describe('SyncChannelCoordinator', () => {
  it('starts only the explicitly selected P2P channel', async () => {
    const events: string[] = [];
    const coordinator = new SyncChannelCoordinator(runtime('p2p', events), runtime('lan', events));

    await coordinator.select('p2p');

    expect(events).toEqual(['p2p:start']);
  });

  it('stops P2P before starting the explicitly selected LAN channel', async () => {
    const events: string[] = [];
    const coordinator = new SyncChannelCoordinator(runtime('p2p', events), runtime('lan', events));

    await coordinator.select('p2p');
    await coordinator.select('lan');

    expect(events).toEqual(['p2p:start', 'p2p:stop', 'lan:start']);
  });

  it('refreshes the selected channel without starting the other channel', async () => {
    const events: string[] = [];
    const coordinator = new SyncChannelCoordinator(runtime('p2p', events), runtime('lan', events));

    await coordinator.select('lan');
    await coordinator.select('lan');

    expect(events).toEqual(['lan:start', 'lan:start']);
  });

  it('does not fall back to LAN when P2P fails to start', async () => {
    const events: string[] = [];
    const p2p: SyncChannelRuntime = {
      start: async () => {
        events.push('p2p:start');
        throw new Error('p2p unavailable');
      },
      stop: async () => {
        events.push('p2p:stop');
      },
    };
    const coordinator = new SyncChannelCoordinator(p2p, runtime('lan', events));

    await expect(coordinator.select('p2p')).rejects.toThrow('p2p unavailable');

    expect(events).toEqual(['p2p:start']);
    expect(coordinator.getActiveChannel()).toBeNull();
  });

  it('serializes rapid channel changes so the latest selection wins', async () => {
    const events: string[] = [];
    let finishP2pStop: (() => void) | undefined;
    const p2p: SyncChannelRuntime = {
      start: async () => {
        events.push('p2p:start');
      },
      stop: async () => {
        events.push('p2p:stop');
        await new Promise<void>((resolve) => {
          finishP2pStop = resolve;
        });
      },
    };
    const coordinator = new SyncChannelCoordinator(p2p, runtime('lan', events));
    await coordinator.select('p2p');
    events.length = 0;

    const selectLan = coordinator.select('lan');
    await Promise.resolve();
    const selectP2p = coordinator.select('p2p');
    await Promise.resolve();

    expect(events).toEqual(['p2p:stop']);
    finishP2pStop?.();
    await Promise.all([selectLan, selectP2p]);

    expect(events).toEqual(['p2p:stop', 'lan:start', 'lan:stop', 'p2p:start']);
    expect(coordinator.getActiveChannel()).toBe('p2p');
  });
});
