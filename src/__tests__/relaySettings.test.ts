import { describe, expect, it, jest } from '@jest/globals';

jest.mock('app-group-store', () => ({
  getEngineLogFileUris: () => [],
}));

import {
  configureRelaySettings,
  saveCustomRelay,
  type RelaySettingsApi,
} from '../features/relaySettings';

function source(relativePath: string): string {
  return require('fs').readFileSync(require('path').join(__dirname, '..', relativePath), 'utf8');
}

describe('custom relay settings', () => {
  it('adds a normalized relay address without replacing the configured nodes', async () => {
    const saveCustomRelayNode = jest
      .fn<RelaySettingsApi['saveCustomRelayNode']>()
      .mockResolvedValue({
        configured: true,
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
    const ios = source('screens/settings/ios/SpacePage.tsx');

    expect(android.indexOf('space.devices.otherTitle')).toBeLessThan(
      android.indexOf('<CustomRelaySection />')
    );
    expect(android.indexOf('<CustomRelaySection />')).toBeLessThan(
      android.indexOf('space.switch.title')
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
  });
});
