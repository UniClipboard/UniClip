import { migrateConfig, extractRuntimeState } from '../services/ConfigMigration';
import { DEFAULT_SETTINGS, RUNTIME_STATE_DEFAULTS } from '../types/settings';
import { SyncMode, ConflictResolution } from '../types/sync';

describe('migrateConfig', () => {
  it('returns defaults for null/undefined input', () => {
    expect(migrateConfig(null)).toEqual(DEFAULT_SETTINGS);
    expect(migrateConfig(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for empty object', () => {
    expect(migrateConfig({})).toEqual(DEFAULT_SETTINGS);
  });

  it('preserves already-migrated settings', () => {
    const current = { ...DEFAULT_SETTINGS, autoApplyRemote: false, logLevel: 'debug' as const };
    const result = migrateConfig(current);
    expect(result.autoApplyRemote).toBe(false);
    expect(result.logLevel).toBe('debug');
  });

  // --- autoSync → autoApplyRemote + autoPushLocal ---

  it('maps autoSync: true → autoApplyRemote: true + autoPushLocal: true', () => {
    const old = { autoSync: true };
    const result = migrateConfig(old);
    expect(result.autoApplyRemote).toBe(true);
    expect(result.autoPushLocal).toBe(true);
  });

  it('maps autoSync: false → autoApplyRemote: true (default) + autoPushLocal: false', () => {
    const old = { autoSync: false };
    const result = migrateConfig(old);
    expect(result.autoApplyRemote).toBe(true);
    expect(result.autoPushLocal).toBe(false);
  });

  it('does not use autoSync if autoApplyRemote already present', () => {
    const old = { autoSync: true, autoApplyRemote: false };
    const result = migrateConfig(old);
    expect(result.autoApplyRemote).toBe(false);
  });

  // --- theme → appearance ---

  it('maps theme: "auto" → appearance: "system"', () => {
    const result = migrateConfig({ theme: 'auto' });
    expect(result.appearance).toBe('system');
  });

  it('maps theme: "light" → appearance: "light"', () => {
    const result = migrateConfig({ theme: 'light' });
    expect(result.appearance).toBe('light');
  });

  it('maps theme: "dark" → appearance: "dark"', () => {
    const result = migrateConfig({ theme: 'dark' });
    expect(result.appearance).toBe('dark');
  });

  it('does not use theme if appearance already present', () => {
    const result = migrateConfig({ theme: 'dark', appearance: 'light' });
    expect(result.appearance).toBe('light');
  });

  // --- historyImageAutoDownload → attachmentAutoDownload ---

  it('maps historyImageAutoDownload → attachmentAutoDownload', () => {
    expect(migrateConfig({ historyImageAutoDownload: 'always' }).attachmentAutoDownload).toBe(
      'always'
    );
    expect(migrateConfig({ historyImageAutoDownload: 'off' }).attachmentAutoDownload).toBe('off');
    expect(migrateConfig({ historyImageAutoDownload: 'wifi' }).attachmentAutoDownload).toBe('wifi');
  });

  it('does not use historyImageAutoDownload if attachmentAutoDownload already present', () => {
    const result = migrateConfig({
      historyImageAutoDownload: 'always',
      attachmentAutoDownload: 'off',
    });
    expect(result.attachmentAutoDownload).toBe('off');
  });

  // --- syncInBackground → enableBackgroundTasks ---

  it('maps syncInBackground: true → enableBackgroundTasks: true', () => {
    const result = migrateConfig({ syncInBackground: true });
    expect(result.enableBackgroundTasks).toBe(true);
  });

  it('does not use syncInBackground if enableBackgroundTasks already set', () => {
    const result = migrateConfig({ syncInBackground: true, enableBackgroundTasks: false });
    expect(result.enableBackgroundTasks).toBe(false);
  });

  // --- new fields get defaults ---

  it('adds trustInsecureCert with default when missing', () => {
    const result = migrateConfig({ autoCheckUpdate: true });
    expect(result.trustInsecureCert).toBe(false);
  });

  it('adds payloadCacheMaxBytes with default when missing', () => {
    const result = migrateConfig({});
    expect(result.payloadCacheMaxBytes).toBe(200 * 1024 * 1024);
  });

  it('adds ignoredVersion with default when missing', () => {
    const result = migrateConfig({});
    expect(result.ignoredVersion).toBeNull();
  });

  it('adds downloadRelativePath with default when missing', () => {
    const result = migrateConfig({});
    expect(result.downloadRelativePath).toBe('');
  });

  // --- passthrough for SyncManager internals ---

  it('preserves syncMode when present', () => {
    const result = migrateConfig({ syncMode: SyncMode.Auto });
    expect(result.syncMode).toBe(SyncMode.Auto);
  });

  it('preserves conflictResolution when present', () => {
    const result = migrateConfig({ conflictResolution: ConflictResolution.UseLocal });
    expect(result.conflictResolution).toBe(ConflictResolution.UseLocal);
  });

  // --- runtime state fields excluded ---

  it('does not include lastUpdateCheckDate in result', () => {
    const result = migrateConfig({ lastUpdateCheckDate: '2026-06-20' });
    expect(result).not.toHaveProperty('lastUpdateCheckDate');
  });

  it('does not include needsHistoryReorganize in result', () => {
    const result = migrateConfig({ needsHistoryReorganize: true });
    expect(result).not.toHaveProperty('needsHistoryReorganize');
  });

  // --- full old schema migration ---

  it('migrates a complete v1 config correctly', () => {
    const v1Config = {
      servers: [{ url: 'http://test', username: 'u', password: 'p' }],
      activeServerIndex: 0,
      syncMode: 'manual',
      syncInterval: 5000,
      conflictResolution: 'newest',
      enableOfflineQueue: true,
      maxOfflineQueueSize: 100,
      syncLargeFiles: true,
      largeFileThreshold: 10485760,
      theme: 'auto',
      language: 'zh-CN',
      enableNotifications: true,
      syncInBackground: true,
      syncOnStartup: true,
      autoSync: true,
      autoDownloadMaxSize: 5242880,
      debugMode: false,
      maxHistoryItems: 500,
      autoCheckUpdate: true,
      lastUpdateCheckDate: '2026-06-20',
      updateToBeta: false,
      enableHistorySync: true,
      logLevel: 'info',
      remotePollingInterval: 3000,
      localPollingInterval: 1000,
      enableBackgroundTasks: false,
      enableBackgroundDownload: false,
      enableBackgroundUpload: false,
      enableClipboardOverlay: false,
      enableSmsForwarding: false,
      enableForegroundNotification: true,
      syncToastEnabled: true,
      hideFromRecents: false,
      historyImageAutoDownload: 'always',
      showImageCopyButton: true,
      debugOverlayVisible: false,
      debugUrlScheme: false,
      debugUpdateCheckNoLimit: false,
      needsHistoryReorganize: false,
    };

    const result = migrateConfig(v1Config);

    // Renamed fields
    expect(result.autoApplyRemote).toBe(true);
    expect(result.autoPushLocal).toBe(true);
    expect(result.appearance).toBe('system');
    expect(result.attachmentAutoDownload).toBe('always');
    expect(result.enableBackgroundTasks).toBe(false); // explicit value wins over syncInBackground

    // New fields with defaults
    expect(result.trustInsecureCert).toBe(false);
    expect(result.payloadCacheMaxBytes).toBe(200 * 1024 * 1024);
    expect(result.ignoredVersion).toBeNull();
    expect(result.downloadRelativePath).toBe('');

    // Preserved fields
    expect(result.maxHistoryItems).toBe(500);
    expect(result.enableHistorySync).toBe(true);
    expect(result.showImageCopyButton).toBe(true);

    // Runtime state excluded
    expect(result).not.toHaveProperty('lastUpdateCheckDate');
    expect(result).not.toHaveProperty('needsHistoryReorganize');

    // Deprecated fields excluded
    expect(result).not.toHaveProperty('autoSync');
    expect(result).not.toHaveProperty('theme');
    expect(result).not.toHaveProperty('historyImageAutoDownload');
    expect(result).not.toHaveProperty('syncInBackground');
  });
});

describe('extractRuntimeState', () => {
  it('returns defaults for null/undefined input', () => {
    expect(extractRuntimeState(null)).toEqual(RUNTIME_STATE_DEFAULTS);
    expect(extractRuntimeState(undefined)).toEqual(RUNTIME_STATE_DEFAULTS);
  });

  it('extracts lastUpdateCheckDate', () => {
    const result = extractRuntimeState({ lastUpdateCheckDate: '2026-06-20' });
    expect(result.lastUpdateCheckDate).toBe('2026-06-20');
  });

  it('extracts needsHistoryReorganize', () => {
    const result = extractRuntimeState({ needsHistoryReorganize: true });
    expect(result.needsHistoryReorganize).toBe(true);
  });

  it('uses defaults for missing fields', () => {
    const result = extractRuntimeState({ someOtherField: true });
    expect(result.lastUpdateCheckDate).toBe('');
    expect(result.needsHistoryReorganize).toBe(false);
  });
});
