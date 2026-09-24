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
    const rebuildRelayEndpoint = jest.fn<RelaySettingsApi['rebuildRelayEndpoint']>();
    configureRelaySettings({ saveCustomRelayNode, rebuildRelayEndpoint });

    await expect(
      saveCustomRelay({
        url: ' https://relay.example.com/ ',
        accessToken: ' private-token ',
        currentUrls: ['https://relay-a.example.com'],
      })
    ).resolves.toEqual({
      configured: true,
      urls: ['https://relay-a.example.com', 'https://relay.example.com'],
    });

    expect(saveCustomRelayNode).toHaveBeenCalledWith('https://relay.example.com', 'private-token');
    expect(rebuildRelayEndpoint).toHaveBeenCalledTimes(1);
    expect(saveCustomRelayNode.mock.invocationCallOrder[0]).toBeLessThan(
      rebuildRelayEndpoint.mock.invocationCallOrder[0]
    );
  });

  it('removes only the selected relay node', async () => {
    const saveCustomRelayNode = jest
      .fn<RelaySettingsApi['saveCustomRelayNode']>()
      .mockResolvedValue({
        configured: false,
      });
    const rebuildRelayEndpoint = jest.fn<RelaySettingsApi['rebuildRelayEndpoint']>();
    configureRelaySettings({ saveCustomRelayNode, rebuildRelayEndpoint });

    await expect(
      saveCustomRelay({
        url: '',
        accessToken: '',
        previousUrl: 'https://relay-a.example.com',
        currentUrls: ['https://relay-a.example.com', 'https://relay-b.example.com'],
      })
    ).resolves.toEqual({ configured: false, urls: ['https://relay-b.example.com'] });

    expect(saveCustomRelayNode).toHaveBeenCalledWith('', '', 'https://relay-a.example.com');
    expect(rebuildRelayEndpoint).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported relay addresses before calling the native engine', async () => {
    const saveCustomRelayNode = jest.fn<RelaySettingsApi['saveCustomRelayNode']>();
    const rebuildRelayEndpoint = jest.fn<RelaySettingsApi['rebuildRelayEndpoint']>();
    configureRelaySettings({ saveCustomRelayNode, rebuildRelayEndpoint });

    await expect(
      saveCustomRelay({
        url: 'ftp://relay.example.com',
        accessToken: '',
        currentUrls: [],
      })
    ).rejects.toThrow('Relay address must use HTTP or HTTPS');

    expect(saveCustomRelayNode).not.toHaveBeenCalled();
    expect(rebuildRelayEndpoint).not.toHaveBeenCalled();
  });

  it('places the relay settings between space devices and switching spaces on both platforms', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const androidSettings = source('screens/settings/android/SpaceSettingsSection.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    // Android:设备页只列设备,中继与切换空间在「空间设置」二级页
    expect(android.indexOf('space.devices.otherTitle')).toBeLessThan(
      android.indexOf("section: 'spaceSettings'")
    );
    expect(android).not.toContain('<CustomRelaySection />');
    expect(androidSettings.indexOf('<CustomRelaySection />')).toBeGreaterThan(-1);
    expect(androidSettings.indexOf('<CustomRelaySection />')).toBeLessThan(
      androidSettings.indexOf('<SwitchSpaceRow')
    );
    expect(ios.indexOf('space.devices.title')).toBeLessThan(ios.indexOf('<CustomRelaySection />'));
    expect(ios.indexOf('<CustomRelaySection />')).toBeLessThan(ios.indexOf('space.switch.title'));
  });

  it('keeps the Android relay form in an advanced settings sheet', () => {
    const androidRelay = source('screens/settings/CustomRelaySection.android.tsx');

    expect(androidRelay).toContain('showRelaySettings');
    expect(androidRelay).toContain('<ModalBottomSheet');
    expect(androidRelay).toContain('relay.summary');
  });

  it('animates between the Android relay list and editor within the same sheet', () => {
    const androidRelay = source('screens/settings/CustomRelaySection.android.tsx');

    expect(androidRelay).toContain('<SheetPageTransition');
  });

  it('shows every configured relay node and provides per-node editing on both platforms', () => {
    for (const relativePath of [
      'screens/settings/CustomRelaySection.android.tsx',
      'screens/settings/CustomRelaySection.ios.tsx',
    ]) {
      const relay = source(relativePath);

      expect(relay).toContain('customRelayUrls');
      expect(relay).toContain('EMPTY_RELAY_URLS');
      expect(relay).toContain('configuredUrls.map');
      expect(relay).toContain('openAddRelay');
      expect(relay).toContain("save('')");
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
