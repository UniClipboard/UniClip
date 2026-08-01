import { describe, expect, it, jest } from '@jest/globals';
import {
  P2pSpaceSetupCoordinator,
  type P2pSpaceSetupDependencies,
} from '../services/P2pSpaceSetupCoordinator';

function createDependencies() {
  const events: string[] = [];
  const dependencies: P2pSpaceSetupDependencies = {
    activate: jest.fn(async () => {
      events.push('activate');
    }),
  };
  return { dependencies, events };
}

describe('P2pSpaceSetupCoordinator', () => {
  it('activates the P2P runtime before setup', async () => {
    const { dependencies, events } = createDependencies();
    const coordinator = new P2pSpaceSetupCoordinator(dependencies);

    await expect(
      coordinator.run(async () => {
        events.push('setup');
        return 'created';
      })
    ).resolves.toBe('created');

    expect(events).toEqual(['activate', 'setup']);
  });

  it('propagates setup failures without changing transport state', async () => {
    const { dependencies, events } = createDependencies();
    const coordinator = new P2pSpaceSetupCoordinator(dependencies);

    await expect(
      coordinator.run(async () => {
        events.push('setup');
        throw new Error('invalid invitation');
      })
    ).rejects.toThrow('invalid invitation');

    expect(events).toEqual(['activate', 'setup']);
  });

  it('does not run setup when P2P activation fails', async () => {
    const { dependencies, events } = createDependencies();
    dependencies.activate = jest.fn(async () => {
      throw new Error('engine unavailable');
    });
    const setup = jest.fn(async () => 'created');
    const coordinator = new P2pSpaceSetupCoordinator(dependencies);

    await expect(coordinator.run(setup)).rejects.toThrow('engine unavailable');

    expect(setup).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
