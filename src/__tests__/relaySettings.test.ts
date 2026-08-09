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
  it('saves a normalized relay address with its optional access token', async () => {
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
      })
    ).resolves.toEqual({ configured: true });

    expect(saveCustomRelayNode).toHaveBeenCalledWith('https://relay.example.com', 'private-token');
    expect(rebuildRelayEndpoint).toHaveBeenCalledTimes(1);
    expect(saveCustomRelayNode.mock.invocationCallOrder[0]).toBeLessThan(
      rebuildRelayEndpoint.mock.invocationCallOrder[0]
    );
  });

  it('removes the configured relay when its address is cleared', async () => {
    const saveCustomRelayNode = jest
      .fn<RelaySettingsApi['saveCustomRelayNode']>()
      .mockResolvedValue({
        configured: false,
      });
    const rebuildRelayEndpoint = jest.fn<RelaySettingsApi['rebuildRelayEndpoint']>();
    configureRelaySettings({ saveCustomRelayNode, rebuildRelayEndpoint });

    await expect(saveCustomRelay({ url: '', accessToken: '' })).resolves.toEqual({
      configured: false,
    });

    expect(saveCustomRelayNode).toHaveBeenCalledWith('', '');
    expect(rebuildRelayEndpoint).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported relay addresses before calling the native engine', async () => {
    const saveCustomRelayNode = jest.fn<RelaySettingsApi['saveCustomRelayNode']>();
    const rebuildRelayEndpoint = jest.fn<RelaySettingsApi['rebuildRelayEndpoint']>();
    configureRelaySettings({ saveCustomRelayNode, rebuildRelayEndpoint });

    await expect(
      saveCustomRelay({ url: 'ftp://relay.example.com', accessToken: '' })
    ).rejects.toThrow('Relay address must use HTTP or HTTPS');

    expect(saveCustomRelayNode).not.toHaveBeenCalled();
    expect(rebuildRelayEndpoint).not.toHaveBeenCalled();
  });

  it('places the relay settings between space devices and switching spaces on both platforms', () => {
    const android = source('screens/settings/UnifiedSpaceSetup.android.tsx');
    const ios = source('screens/settings/ios/SpacePage.tsx');

    for (const platform of [android, ios]) {
      expect(platform.indexOf('space.devices.title')).toBeLessThan(
        platform.indexOf('<CustomRelaySection />')
      );
      expect(platform.indexOf('<CustomRelaySection />')).toBeLessThan(
        platform.indexOf('space.switch.title')
      );
    }
  });
});
