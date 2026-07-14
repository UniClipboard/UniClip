import { describe, expect, it } from '@jest/globals';
import { createDefaultSettings } from '../types/settings';

describe('platform settings defaults', () => {
  it('enables automatic pull and push on iOS', () => {
    const settings = createDefaultSettings('ios');

    expect(settings.autoApplyRemote).toBe(true);
    expect(settings.autoPushLocal).toBe(true);
  });

  it('keeps automatic push disabled by default on Android', () => {
    const settings = createDefaultSettings('android');

    expect(settings.autoApplyRemote).toBe(true);
    expect(settings.autoPushLocal).toBe(false);
  });
});
