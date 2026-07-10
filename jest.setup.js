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

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
}));

// expo-localization 会拉入 expo-modules-core(在 node 测试环境下缺 EventEmitter 而抛错)。
// 直接 mock 掉,返回一个 zh 设备语言,使 i18n 初始化为 zh-CN(与测试对基准中文文案的断言一致)。
jest.mock('expo-localization', () => ({
  getLocales: () => [
    {
      languageCode: 'zh',
      languageTag: 'zh-CN',
      regionCode: 'CN',
      textDirection: 'ltr',
      decimalSeparator: '.',
      digitGroupingSeparator: ',',
      measurementSystem: 'metric',
      currencyCode: 'CNY',
      currencySymbol: '¥',
    },
  ],
  getCalendars: () => [{ calendar: 'gregory', timeZone: 'Asia/Shanghai', uses24hourClock: true, firstWeekday: 1 }],
}));

jest.mock('react-native-logs', () => ({
  consoleTransport: jest.fn(),
  logger: {
    createLogger: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      patchConsole: jest.fn(),
      setSeverity: jest.fn(),
    })),
  },
}));

jest.mock('expo-file-system', () => {
  class MockDirectory {
    constructor(...parts) {
      this.parts = parts;
      this.name = String(parts[parts.length - 1] ?? '');
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part?.uri ?? ''))
        .join('/')
        .replace(/\/+/g, '/')
        .replace('file:/', 'file://');
      this.exists = true;
      this.isDirectory = true;
    }

    create = jest.fn();
    delete = jest.fn();
    list = jest.fn(() => []);
  }

  class MockFile {
    constructor(...parts) {
      this.parts = parts;
      this.name = String(parts[parts.length - 1] ?? '');
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part?.uri ?? ''))
        .join('/')
        .replace(/\/+/g, '/')
        .replace('file:/', 'file://');
      this.exists = true;
      this.isDirectory = false;
    }

    info = jest.fn().mockReturnValue({ exists: true, size: 1000 });
    open = jest.fn().mockReturnValue({
      readBytes: jest.fn().mockReturnValue(new Uint8Array(10)),
      close: jest.fn(),
    });
    textSync = jest.fn().mockReturnValue('');
    write = jest.fn();
    delete = jest.fn();
    move = jest.fn();
    arrayBuffer = jest.fn().mockResolvedValue(new ArrayBuffer(0));

    static downloadFileAsync = jest.fn().mockResolvedValue(undefined);
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: {
      document: 'file://documents',
      cache: 'file://cache',
    },
    DocumentDirectory: 'file://documents/',
    CacheDirectory: 'file://cache/',
  };
});

jest.mock('expo-file-system/legacy', () => ({
  StorageAccessFramework: {
    requestDirectoryPermissionsAsync: jest.fn(),
    createFileAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
  },
  EncodingType: {
    Base64: 'base64',
    UTF8: 'utf8',
  },
  readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
  getInfoAsync: jest.fn(),
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

jest.mock('android-util', () => ({
  isNativeHashModuleAvailable: jest.fn().mockReturnValue(false),
  nativeCalculateFileHash: jest.fn(),
  isTailscaleActive: jest.fn().mockReturnValue(false),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(),
  },
}));

jest.mock('app-group-store', () => ({
  saveServers: jest.fn().mockResolvedValue(undefined),
  getServers: jest.fn().mockResolvedValue({ configs: [], activeConfigId: null }),
  saveSettings: jest.fn().mockResolvedValue(undefined),
  getSettings: jest.fn().mockResolvedValue({}),
  getContainerUrl: jest.fn().mockResolvedValue(null),
  getLegacyHistory: jest.fn().mockResolvedValue(null),
  getPayloadFileUri: jest.fn().mockResolvedValue(null),
  writePayload: jest.fn().mockResolvedValue(null),
  deletePayload: jest.fn().mockResolvedValue(undefined),
  clearPayloads: jest.fn().mockResolvedValue(undefined),
  getPayloadStats: jest.fn().mockResolvedValue({ count: 0, totalSize: 0 }),
  getLastSyncedHash: jest.fn().mockResolvedValue(null),
  getLastSyncedContentId: jest.fn().mockResolvedValue(null),
  getLiveUrl: jest.fn().mockResolvedValue(null),
  saveLiveUrl: jest.fn().mockResolvedValue(undefined),
  migrateLegacyContainer: jest.fn().mockResolvedValue({ migrated: false, keys: 0 }),
  getPasteboardChangeCount: jest.fn(() => null),
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
  // SSE subscription bridge
  hasSse: jest.fn(() => false),
  startSseSubscription: jest.fn(),
  cancelSseSubscription: jest.fn(),
  addSseListener: jest.fn(() => ({ remove: jest.fn() })),
  // MobileSyncEngine (push/pull SDK)
  hasEngine: jest.fn(() => true),
  engineInit: jest.fn(),
  engineDispose: jest.fn(),
  enginePush: jest.fn(),
  enginePull: jest.fn(),
  engineApplyStaged: jest.fn(),
  engineSetServer: jest.fn().mockResolvedValue(undefined),
  engineHandleNetworkRouteChanged: jest.fn().mockResolvedValue(undefined),
  engineSetSettings: jest.fn().mockResolvedValue(undefined),
  engineAcknowledgeLoopDetected: jest.fn().mockResolvedValue(undefined),
  // Sync config + cadence helpers (survivors from the pre-engine reducer design)
  defaultSyncConfig: jest.fn(() => ({
    normalCadenceSecs: 1.0,
    inactiveCadenceSecs: 5.0,
    offlineBackoffSecs: 5.0,
    offlineBackoffMaxSecs: 60.0,
    historySyncIntervalSecs: 30.0,
    loopWindowSecs: 30.0,
    loopFlipThreshold: 3,
  })),
  isHistorySyncDue: jest.fn(() => false),
  isColdStart: jest.fn(() => false),
  advanceWatermark: jest.fn(),
}));

global.setImmediate = jest.useRealTimers;

// 每个测试后重置 SQLite 单例,保证测试间使用全新的 :memory: 数据库(隔离)
afterEach(async () => {
  try {
    const { _closeDatabaseForTest } = require('@/services/db/database');
    await _closeDatabaseForTest();
  } catch {
    // db 模块未加载或未打开,忽略
  }
});
