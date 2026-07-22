import { describe, expect, it } from '@jest/globals';
import { createDefaultSettings } from '../types/settings';

describe('platform settings defaults', () => {
  it('uses the P2P channel for new installs', () => {
    expect(createDefaultSettings('ios').syncChannel).toBe('p2p');
    expect(createDefaultSettings('android').syncChannel).toBe('p2p');
  });

  it('enables automatic pull and push on iOS', () => {
    const settings = createDefaultSettings('ios');

    expect(settings.autoApplyRemote).toBe(true);
    expect(settings.autoPushLocal).toBe(true);
  });

  it('enables automatic pull and push on Android', () => {
    const settings = createDefaultSettings('android');

    expect(settings.autoApplyRemote).toBe(true);
    expect(settings.autoPushLocal).toBe(true);
  });
});
