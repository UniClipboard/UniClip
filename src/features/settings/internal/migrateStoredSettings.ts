import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, type AppSettings } from '@/types/settings';

export function migrateStoredSettings(raw: unknown, sourceSchemaVersion: number): AppSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };

  const old = raw as Record<string, unknown>;
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (old[key] !== undefined) result[key] = old[key];
  }

  const upgradedFromLan =
    sourceSchemaVersion < SETTINGS_SCHEMA_VERSION &&
    (old.syncChannel === 'lan' ||
      old.legacyLanEligible === true ||
      (Array.isArray(old.servers) && old.servers.length > 0));

  if (upgradedFromLan) result.legacyPairingGuide = 'pending';

  return result as unknown as AppSettings;
}
