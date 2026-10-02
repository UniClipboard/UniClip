import { describe, expect, it } from '@jest/globals';

import { describeRelayOverview, type RelayOverview } from '../features/relayOverview';

const builtIn = (regionId: string | null, inEffect: boolean) => ({
  source: 'builtIn' as const,
  regionId,
  url: `https://${regionId ?? 'future'}.relay.example.`,
  credentialConfigured: false,
  inEffect,
});
const overview = (patch: Partial<RelayOverview> = {}): RelayOverview => ({
  savedMode: 'builtIn',
  appliedMode: 'builtIn',
  changePending: false,
  entries: [builtIn('na-east', true), builtIn('eu', true)],
  ...patch,
});

describe('relay overview presentation', () => {
  it('lists built-in entries with localized region keys and URL fallback for unknown regions', () => {
    const view = describeRelayOverview(overview({ entries: [builtIn('eu', true), builtIn('mars', true), builtIn(null, true)] }));
    expect(view.builtInRows.map((row) => row.regionKey)).toEqual(['relay.region.eu', null, null]);
    expect(view.builtInRows[1]?.url).toBe('https://mars.relay.example.');
  });

  it('marks built-in rows in effect only when Engine reports the running node uses them', () => {
    const view = describeRelayOverview(overview());
    expect(view.builtInRows.map((row) => row.usage)).toEqual(['inEffect', 'inEffect']);
    expect(view.statusKey).toBe('relay.status.builtIn');
  });

  it('does not claim any row is in effect before the network node exists', () => {
    const view = describeRelayOverview(
      overview({ appliedMode: null, entries: [builtIn('eu', false)] })
    );
    expect(view.builtInRows[0]?.usage).toBe('notApplied');
    expect(view.nodeNotStarted).toBe(true);
  });

  it('shows built-in rows as replaced when custom relays are saved', () => {
    const view = describeRelayOverview(
      overview({
        savedMode: 'custom',
        appliedMode: 'custom',
        entries: [builtIn('eu', false), { source: 'custom', url: 'https://mine.example.com', credentialConfigured: true, inEffect: true }],
      })
    );
    expect(view.builtInRows[0]?.usage).toBe('replacedByCustom');
    expect(view.statusKey).toBe('relay.status.custom');
  });

  it('keeps the running state while a saved change is pending', () => {
    const view = describeRelayOverview(
      overview({ savedMode: 'custom', appliedMode: 'builtIn', changePending: true })
    );
    expect(view.builtInRows.map((row) => row.usage)).toEqual(['inEffect', 'inEffect']);
    expect(view.changePending).toBe(true);
  });

  it('dims entries when relays are off', () => {
    const view = describeRelayOverview(
      overview({ savedMode: 'disabled', appliedMode: 'disabled', entries: [builtIn('eu', false)] })
    );
    expect(view.builtInRows[0]?.usage).toBe('off');
    expect(view.statusKey).toBe('relay.status.off');
  });

  it('uses an informational status tone, and a warning tone only while a change is pending', () => {
    expect(describeRelayOverview(overview()).tone).toBe('info');
    expect(describeRelayOverview(overview({ changePending: true })).tone).toBe('warn');
  });

  it('summarizes the saved routing for the entry row without claiming a connection', () => {
    expect(describeRelayOverview(overview()).summary).toEqual({ kind: 'builtIn' });
    expect(
      describeRelayOverview(
        overview({
          savedMode: 'custom',
          entries: [
            builtIn('eu', false),
            { source: 'custom', url: 'https://a.example.com', credentialConfigured: false, inEffect: true },
            { source: 'custom', url: 'https://b.example.com', credentialConfigured: true, inEffect: true },
          ],
        })
      ).summary
    ).toEqual({ kind: 'custom', count: 2 });
    expect(describeRelayOverview(overview({ savedMode: 'disabled' })).summary).toEqual({ kind: 'off' });
  });
});
