export type RelayRoutingMode = 'builtIn' | 'custom' | 'disabled';

export interface RelayOverviewEntry {
  source: 'builtIn' | 'custom';
  regionId?: string | null;
  url: string;
  credentialConfigured: boolean;
  inEffect: boolean;
}

export interface RelayOverview {
  savedMode: RelayRoutingMode;
  appliedMode?: RelayRoutingMode | null;
  changePending: boolean;
  entries: RelayOverviewEntry[];
}

export type BuiltInRelayUsage = 'inEffect' | 'notApplied' | 'replacedByCustom' | 'off';

export const BUILT_IN_USAGE_KEY: Record<BuiltInRelayUsage, string> = {
  inEffect: 'relay.usage.inEffect',
  notApplied: 'relay.usage.notApplied',
  replacedByCustom: 'relay.usage.replacedByCustom',
  off: 'relay.usage.off',
};

export interface BuiltInRelayRow {
  key: string;
  /** Translation key for a known region; null means the caller shows the URL instead. */
  regionKey: string | null;
  url: string;
  usage: BuiltInRelayUsage;
}

export type RelaySummary = { kind: 'builtIn' } | { kind: 'custom'; count: number } | { kind: 'off' };

export interface RelayOverviewView {
  statusKey: 'relay.status.builtIn' | 'relay.status.custom' | 'relay.status.off';
  /** Explanation under the status title (same suffix as `statusKey`, plus `Hint`). */
  statusHintKey: 'relay.status.builtInHint' | 'relay.status.customHint' | 'relay.status.offHint';
  tone: 'info' | 'warn';
  /** Saved routing in short form for the Space settings entry row. */
  summary: RelaySummary;
  /** Engine reported no network node yet, so no row can be claimed as in effect. */
  nodeNotStarted: boolean;
  changePending: boolean;
  builtInRows: BuiltInRelayRow[];
}

const KNOWN_REGIONS = new Set(['na-east', 'na-west', 'eu', 'asia-pacific']);

function usageOf(entry: RelayOverviewEntry, savedMode: RelayOverview['savedMode']): BuiltInRelayUsage {
  // `inEffect` only says the running node is configured with this relay; it never means connected.
  if (entry.inEffect) return 'inEffect';
  if (savedMode === 'disabled') return 'off';
  if (savedMode === 'custom') return 'replacedByCustom';
  return 'notApplied';
}

export function describeRelayOverview(overview: RelayOverview): RelayOverviewView {
  const statusKey = {
    builtIn: 'relay.status.builtIn',
    custom: 'relay.status.custom',
    disabled: 'relay.status.off',
  } as const;
  return {
    statusKey: statusKey[overview.savedMode],
    statusHintKey: {
      builtIn: 'relay.status.builtInHint',
      custom: 'relay.status.customHint',
      disabled: 'relay.status.offHint',
    }[overview.savedMode] as RelayOverviewView['statusHintKey'],
    tone: overview.changePending ? 'warn' : 'info',
    summary:
      overview.savedMode === 'custom'
        ? { kind: 'custom', count: overview.entries.filter((entry) => entry.source === 'custom').length }
        : overview.savedMode === 'disabled'
          ? { kind: 'off' }
          : { kind: 'builtIn' },
    nodeNotStarted: overview.appliedMode == null,
    changePending: overview.changePending,
    builtInRows: overview.entries
      .filter((entry) => entry.source === 'builtIn')
      .map((entry) => ({
        key: entry.url,
        regionKey: entry.regionId && KNOWN_REGIONS.has(entry.regionId) ? `relay.region.${entry.regionId}` : null,
        url: entry.url,
        usage: usageOf(entry, overview.savedMode),
      })),
  };
}
