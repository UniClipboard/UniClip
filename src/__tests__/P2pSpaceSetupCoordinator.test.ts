import { describe, expect, it, jest } from '@jest/globals';
import {
  P2pSpaceSetupCoordinator,
  type P2pSpaceSetupDependencies,
} from '../services/P2pSpaceSetupCoordinator';
import type { SyncConnectionTarget } from '../types/settings';

function createDependencies(initialTarget: SyncConnectionTarget = { kind: 'p2p' }) {
  let selectedTarget = initialTarget;
  const events: string[] = [];
  const dependencies: P2pSpaceSetupDependencies = {
    getSelectedTarget: () => selectedTarget,
    select: jest.fn(async (target) => {
      selectedTarget = target;
      events.push(target.kind === 'p2p' ? 'select:p2p' : `select:lan:${target.serverIndex}`);
      return { ok: true as const };
    }),
    activateSelected: jest.fn(async () => {
      events.push(selectedTarget.kind === 'p2p' ? 'activate:p2p' : 'activate:lan');
    }),
  };
  return { dependencies, events };
}

describe('P2pSpaceSetupCoordinator', () => {
  it('switches an existing LAN user to P2P before setup and keeps it after success', async () => {
    const { dependencies, events } = createDependencies({ kind: 'lan', serverIndex: 2 });
    const coordinator = new P2pSpaceSetupCoordinator(dependencies);

    await expect(
      coordinator.run(async () => {
        events.push('setup');
        return 'created';
      })
    ).resolves.toBe('created');

    expect(events).toEqual(['select:p2p', 'activate:p2p', 'setup']);
  });

  it('restores the previous LAN connection when setup fails', async () => {
    const { dependencies, events } = createDependencies({ kind: 'lan', serverIndex: 2 });
    const coordinator = new P2pSpaceSetupCoordinator(dependencies);

    await expect(
      coordinator.run(async () => {
        events.push('setup');
        throw new Error('invalid invitation');
      })
    ).rejects.toThrow('invalid invitation');

    expect(events).toEqual(['select:p2p', 'activate:p2p', 'setup', 'select:lan:2', 'activate:lan']);
  });

  it('does not run setup when P2P cannot be selected', async () => {
    const { dependencies, events } = createDependencies({ kind: 'lan', serverIndex: 0 });
    dependencies.select = jest.fn(async () => ({ ok: false as const, error: 'save failed' }));
    const setup = jest.fn(async () => 'created');
    const coordinator = new P2pSpaceSetupCoordinator(dependencies);

    await expect(coordinator.run(setup)).rejects.toThrow('save failed');

    expect(setup).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('ensures an already selected P2P runtime is active before setup', async () => {
    const { dependencies, events } = createDependencies();
    const coordinator = new P2pSpaceSetupCoordinator(dependencies);

    await coordinator.run(async () => {
      events.push('setup');
    });

    expect(dependencies.select).not.toHaveBeenCalled();
    expect(events).toEqual(['activate:p2p', 'setup']);
  });
});
