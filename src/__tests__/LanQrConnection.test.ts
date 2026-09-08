import { LanServerService } from '@/features/lan-servers';
import { connectLanFromQr } from '@/features/lan-servers/connectFromQr';
import type { LanServerProfile } from '@/types/lan';

const intent = {
  name: 'Work computer',
  urls: ['http://work.local:42720'],
  username: 'phone',
  password: 'secret',
};

describe('confirmed QR connection', () => {
  const save = jest.fn(
    async () => ({ id: 'new', name: intent.name, urls: intent.urls } as LanServerProfile)
  );
  beforeEach(() => jest.clearAllMocks());
  it('checks connectivity before activating and saving the connection', async () => {
    const probe = jest.fn(async () => ({ [intent.urls[0]]: 'Success' as const }));
    await connectLanFromQr(intent, { probe, save });
    expect(probe).toHaveBeenCalledWith(expect.objectContaining(intent));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ ...intent, allowInsecureTls: false }),
      undefined,
      { activate: true }
    );
    expect(probe.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]);
  });
  it.each(['AuthFailed', 'Unreachable'] as const)(
    'does not save or change mode on %s',
    async (status) => {
      await expect(
        connectLanFromQr(intent, { probe: async () => ({ [intent.urls[0]]: status }), save })
      ).rejects.toThrow(status);
      expect(save).not.toHaveBeenCalled();
    }
  );
  it('saves the mode and profile together, and removes the new secret if saving fails', async () => {
    const write = jest.fn(async () => {
      throw new Error('disk full');
    });
    const removeSecret = jest.fn(async () => undefined);
    const service = new LanServerService({
      settings: { read: async () => ({ servers: [] }), write },
      secrets: { get: async () => null, set: async () => undefined, delete: removeSecret },
      createId: () => 'new',
    });
    await expect(
      service.save({ ...intent, allowInsecureTls: false }, undefined, { activate: true })
    ).rejects.toThrow('disk full');
    expect(write).toHaveBeenCalledWith({
      servers: [expect.objectContaining({ id: 'new' })],
      syncChannel: 'lan',
    });
    expect(removeSecret).toHaveBeenCalledWith('new');
  });
});
