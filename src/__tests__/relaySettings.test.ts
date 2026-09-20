import { describe, expect, it, jest } from '@jest/globals';
jest.mock('app-group-store', () => ({ getEngineLogFileUris: () => [] }));
import {
  configureRelaySettings,
  refreshCustomRelays,
  saveCustomRelay,
  type CustomRelay,
  type RelaySettingsApi,
} from '../features/relaySettings';

const relay = (url: string, credentialConfigured = false): CustomRelay => ({ url, credentialConfigured });
function api(overrides: Partial<RelaySettingsApi> = {}): RelaySettingsApi {
  return {
    queryCustomRelays: jest.fn<RelaySettingsApi['queryCustomRelays']>().mockResolvedValue([]),
    addCustomRelay: jest.fn<RelaySettingsApi['addCustomRelay']>().mockResolvedValue({ relays: [] }),
    editCustomRelay: jest.fn<RelaySettingsApi['editCustomRelay']>().mockResolvedValue({ relays: [] }),
    deleteCustomRelay: jest.fn<RelaySettingsApi['deleteCustomRelay']>().mockResolvedValue({ relays: [] }),
    rebuildRelayEndpoint: jest.fn<RelaySettingsApi['rebuildRelayEndpoint']>(),
    ...overrides,
  };
}

describe('custom relay settings', () => {
  it('uses Engine data directly when the legacy Mobile cache is empty', async () => {
    const engine = [relay('https://engine.example.com', true)];
    const client = api({ queryCustomRelays: jest.fn().mockResolvedValue(engine) });
    configureRelaySettings(client);
    await expect(refreshCustomRelays([])).resolves.toEqual(engine);
    expect(client.addCustomRelay).not.toHaveBeenCalled();
  });

  it('imports a legacy Mobile-only cache and confirms the authoritative list', async () => {
    const imported = [relay('https://mobile.example.com')];
    const query = jest.fn<RelaySettingsApi['queryCustomRelays']>().mockResolvedValueOnce([]).mockResolvedValueOnce(imported);
    const add = jest.fn<RelaySettingsApi['addCustomRelay']>().mockResolvedValue({ relays: imported });
    configureRelaySettings(api({ queryCustomRelays: query, addCustomRelay: add }));
    await expect(refreshCustomRelays([' https://mobile.example.com/ '])).resolves.toEqual(imported);
    expect(add).toHaveBeenCalledWith('https://mobile.example.com', '');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('preserves Engine relays and imports only normalized Mobile-only relays', async () => {
    const existing = relay('https://shared.example.com', true);
    const combined = [existing, relay('https://mobile.example.com')];
    const query = jest.fn<RelaySettingsApi['queryCustomRelays']>().mockResolvedValueOnce([existing]).mockResolvedValueOnce(combined);
    const add = jest.fn<RelaySettingsApi['addCustomRelay']>().mockResolvedValue({ relays: combined });
    configureRelaySettings(api({ queryCustomRelays: query, addCustomRelay: add }));
    await expect(refreshCustomRelays(['https://shared.example.com/', 'https://mobile.example.com', 'https://mobile.example.com/'])).resolves.toEqual(combined);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('https://mobile.example.com', '');
  });

  it('recovers when an earlier migration stopped after Engine wrote the relay', async () => {
    const existing = [relay('https://mobile.example.com')];
    const client = api({ queryCustomRelays: jest.fn().mockResolvedValue(existing) });
    configureRelaySettings(client);
    await expect(refreshCustomRelays(['https://mobile.example.com/'])).resolves.toEqual(existing);
    expect(client.addCustomRelay).not.toHaveBeenCalled();
  });

  it('fails migration when the authoritative list does not confirm every legacy relay', async () => {
    const query = jest
      .fn<RelaySettingsApi['queryCustomRelays']>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([relay('https://other.example.com')]);
    configureRelaySettings(
      api({
        queryCustomRelays: query,
        addCustomRelay: jest.fn().mockResolvedValue({ relays: [] }),
      })
    );

    await expect(refreshCustomRelays(['https://mobile.example.com/'])).rejects.toThrow(
      'Engine did not confirm every legacy relay migration'
    );
  });

  it('preserves only the credential-presence flag from Engine', async () => {
    const existing = [relay('https://secure.example.com', true)];
    const client = api({ queryCustomRelays: jest.fn().mockResolvedValue(existing) });
    configureRelaySettings(client);
    await expect(refreshCustomRelays(['https://secure.example.com'])).resolves.toEqual(existing);
    expect(client.addCustomRelay).not.toHaveBeenCalled();
  });

  it.each(['invalidUrl', 'duplicate', 'notFound'] as const)(
    'refreshes after an Engine %s rejection without rebuilding',
    async (rejection) => {
      const authoritative = [relay('https://existing.example.com')];
      const client = api({
        addCustomRelay: jest.fn().mockResolvedValue({ relays: [], rejection }),
        queryCustomRelays: jest.fn().mockResolvedValue(authoritative),
      });
      configureRelaySettings(client);
      const result = await saveCustomRelay({ url: 'https://new.example.com', accessToken: '' });
      expect(result).toMatchObject({ relays: authoritative, rejection });
      await expect(result.connection).resolves.toBe('unchanged');
      expect(client.queryCustomRelays).toHaveBeenCalledTimes(1);
      expect(client.rebuildRelayEndpoint).not.toHaveBeenCalled();
    }
  );

  it('sends a malformed edit to Engine for rejection instead of deleting the relay', async () => {
    const client = api({
      editCustomRelay: jest.fn().mockResolvedValue({ relays: [], rejection: 'invalidUrl' }),
    });
    configureRelaySettings(client);
    await saveCustomRelay({
      url: 'ftp://invalid.example.com',
      accessToken: '',
      previousUrl: 'https://existing.example.com',
    });
    expect(client.editCustomRelay).toHaveBeenCalledWith(
      'https://existing.example.com',
      'ftp://invalid.example.com',
      ''
    );
    expect(client.deleteCustomRelay).not.toHaveBeenCalled();
  });

  it('reports a saved configuration separately when reconnecting fails', async () => {
    const saved = [relay('https://relay.example.com', true)];
    const client = api({ addCustomRelay: jest.fn().mockResolvedValue({ relays: saved }), rebuildRelayEndpoint: jest.fn().mockRejectedValue(new Error('offline')) });
    configureRelaySettings(client);
    const result = await saveCustomRelay({ url: 'https://relay.example.com/', accessToken: ' secret ' });
    expect(result.relays).toEqual(saved);
    await expect(result.connection).resolves.toBe('retrying');
    expect(client.addCustomRelay).toHaveBeenCalledWith('https://relay.example.com', 'secret');
  });

  it('returns the saved list before network rebuilding finishes', async () => {
    const saved = [relay('https://relay.example.com')];
    let finishRebuild!: () => void;
    const rebuild = new Promise<void>((resolve) => { finishRebuild = resolve; });
    configureRelaySettings(api({
      addCustomRelay: jest.fn().mockResolvedValue({ relays: saved }),
      rebuildRelayEndpoint: jest.fn().mockReturnValue(rebuild),
    }));
    const result = await saveCustomRelay({ url: 'https://relay.example.com', accessToken: '' });
    expect(result.relays).toEqual(saved);
    finishRebuild();
    await expect(result.connection).resolves.toBe('rebuilt');
  });

  it('uses the per-item edit and delete operations', async () => {
    const client = api();
    configureRelaySettings(client);
    await saveCustomRelay({ url: 'https://new.example.com', accessToken: '', previousUrl: 'https://old.example.com' });
    await saveCustomRelay({ url: '', accessToken: '', previousUrl: 'https://new.example.com' });
    expect(client.editCustomRelay).toHaveBeenCalledWith('https://old.example.com', 'https://new.example.com', '');
    expect(client.deleteCustomRelay).toHaveBeenCalledWith('https://new.example.com');
  });
});
