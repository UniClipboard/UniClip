import { describe, expect, it } from '@jest/globals';
import { shouldShowLanMigrationPrompt } from '../services/LanMigrationPolicy';

const legacyLan = {
  legacyLanEligible: true,
  syncChannel: 'lan' as const,
  lanMigrationPromptedVersion: null,
};

describe('shouldShowLanMigrationPrompt', () => {
  it('shows once for an eligible LAN user without a P2P space', () => {
    expect(shouldShowLanMigrationPrompt(legacyLan, '1.5.0', false)).toBe(true);
  });

  it('does not show to a new install', () => {
    expect(
      shouldShowLanMigrationPrompt({ ...legacyLan, legacyLanEligible: false }, '1.5.0', false)
    ).toBe(false);
  });

  it('does not show after the user has selected P2P', () => {
    expect(shouldShowLanMigrationPrompt({ ...legacyLan, syncChannel: 'p2p' }, '1.5.0', false)).toBe(
      false
    );
  });

  it('does not show when a P2P space already exists', () => {
    expect(shouldShowLanMigrationPrompt(legacyLan, '1.5.0', true)).toBe(false);
  });

  it('does not repeat within the same app version', () => {
    expect(
      shouldShowLanMigrationPrompt(
        { ...legacyLan, lanMigrationPromptedVersion: '1.5.0' },
        '1.5.0',
        false
      )
    ).toBe(false);
  });

  it('can remind again after the app version changes', () => {
    expect(
      shouldShowLanMigrationPrompt(
        { ...legacyLan, lanMigrationPromptedVersion: '1.5.0' },
        '1.6.0',
        false
      )
    ).toBe(true);
  });
});
