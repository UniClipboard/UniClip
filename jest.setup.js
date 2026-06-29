jest.mock('expo-crypto', () => ({
  digestStringAsync: jest.fn(),
  CryptoDigestAlgorithm: {
    SHA256: 'SHA-256',
  },
  CryptoEncoding: {
    HEX: 'hex',
  },
}));

jest.mock('expo-clipboard', () => ({
  getStringAsync: jest.fn(),
  setStringAsync: jest.fn(),
  getImageAsync: jest.fn(),
  setImageAsync: jest.fn(),
}));

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    info: jest.fn().mockReturnValue({ exists: true, size: 1000 }),
    open: jest.fn().mockReturnValue({
      readBytes: jest.fn().mockReturnValue(new Uint8Array(10)),
      close: jest.fn(),
    }),
  })),
  DocumentDirectory: 'file://documents/',
  CacheDirectory: 'file://cache/',
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    multiGet: jest.fn().mockResolvedValue([]),
    multiSet: jest.fn().mockResolvedValue(undefined),
    multiRemove: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('native-util', () => ({
  isNativeHashModuleAvailable: jest.fn().mockReturnValue(false),
  nativeCalculateFileHash: jest.fn(),
}));

jest.mock('app-group-store', () => ({
  saveServers: jest.fn().mockResolvedValue(undefined),
  getServers: jest.fn().mockResolvedValue({ configs: [], activeConfigId: null }),
  saveSettings: jest.fn().mockResolvedValue(undefined),
  getSettings: jest.fn().mockResolvedValue({}),
  getLastSyncedHash: jest.fn().mockResolvedValue(null),
  migrateLegacyContainer: jest.fn().mockResolvedValue({ migrated: false, keys: 0 }),
}));

jest.mock('uc-core', () => ({
  parseConnectUri: jest.fn(),
  getLatest: jest.fn(),
  putClipboard: jest.fn(),
  testConnection: jest.fn(),
  queryHistory: jest.fn(),
  getFile: jest.fn(),
  putFile: jest.fn(),
  getHistoryPayload: jest.fn(),
  probe: jest.fn(),
  cancelInFlight: jest.fn(),
  // Sync reducer functions
  defaultSyncConfig: jest.fn(() => ({
    normalCadenceSecs: 1.0,
    inactiveCadenceSecs: 5.0,
    offlineBackoffSecs: 5.0,
    offlineBackoffMaxSecs: 60.0,
    historySyncIntervalSecs: 30.0,
    loopWindowSecs: 30.0,
    loopFlipThreshold: 3,
  })),
  defaultSyncRuntimeState: jest.fn(() => ({
    state: 'Idle',
    lastSyncedHash: null,
    lastAppliedHash: null,
    loopEvents: [],
    stagedServerHash: null,
    stagedEntry: null,
    consecutiveFailures: 0,
    nextAttemptMs: null,
    lastHistorySyncMs: null,
  })),
  planPreamble: jest.fn(),
  planAfterServerGet: jest.fn(),
  commitConverged: jest.fn(),
  commitApply: jest.fn(),
  commitApplyFailed: jest.fn(),
  commitStage: jest.fn(),
  commitPush: jest.fn(),
  commitPushSkipped: jest.fn(),
  commitConsentPush: jest.fn(),
  commitTickSuccess: jest.fn(),
  commitTickFailure: jest.fn(),
  commitHistorySyncDone: jest.fn(),
  markStagedApplied: jest.fn(),
  acknowledgeLoopDetection: jest.fn(),
  resetRuntimeState: jest.fn(),
  handleActiveServerChanged: jest.fn(),
  handleNetworkRouteChanged: jest.fn(),
  hashesEqual: jest.fn(),
  backoffSecs: jest.fn(),
  cadenceSecs: jest.fn(),
  isHistorySyncDue: jest.fn(() => false),
  isColdStart: jest.fn(() => false),
  advanceWatermark: jest.fn(),
  isProbeConclusionValid: jest.fn(),
}));

jest.mock('@microsoft/signalr', () => ({
  HubConnectionBuilder: jest.fn().mockImplementation(() => ({
    withUrl: jest.fn().mockReturnThis(),
    withAutomaticReconnect: jest.fn().mockReturnThis(),
    configureLogging: jest.fn().mockReturnThis(),
    build: jest.fn(),
  })),
}));

global.setImmediate = jest.useRealTimers;
