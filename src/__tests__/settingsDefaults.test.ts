import { describe, expect, it } from '@jest/globals';
import { createDefaultSettings } from '../types/settings';

describe('platform settings defaults', () => {
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

  it('keeps background sync available on mobile data by default', () => {
    expect(createDefaultSettings('android').backgroundSyncNetwork).toBe('any');
  });
});
